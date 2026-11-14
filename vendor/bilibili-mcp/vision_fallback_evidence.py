"""Evidence-only classification of the *optional* subtitle -> preview fallback.

No model invocation, media decoding, access-control decision, or persistent memory.
A successful preview result is NOT evidence of playing the video or listening to
its soundtrack. This module intentionally has no MCP / bilibili_api dependency.
"""
import json


def classify_visual_fallback(result):
    """Return a bounded, non-claiming summary from actual tool result content.

    The MCP text metadata by itself cannot prove that image blocks reached the
    current model. Frames received by MCP and an independent model's reported
    description are distinct evidence levels; neither is a full watch/listen.
    """
    payload = None
    image_blocks = 0
    if isinstance(result, dict):
        payload = result
    elif isinstance(result, str):
        try:
            value = json.loads(result)
            payload = value if isinstance(value, dict) else None
        except (ValueError, TypeError):
            pass
    else:
        for block in getattr(result, 'content', ()) or ():
            kind = getattr(block, 'type', '')
            if kind == 'image':
                image_blocks += 1
            elif kind == 'text':
                try:
                    value = json.loads(getattr(block, 'text', ''))
                    if payload is None and isinstance(value, dict) and ('status' in value or 'ok' in value):
                        payload = value
                except (ValueError, TypeError):
                    pass
    payload = payload or {}
    if getattr(result, 'isError', False) is True:
        payload = {**payload, 'ok': False}
    status = payload.get('status')
    if not isinstance(status, str) or len(status) > 60:
        status = 'unknown'
    good = payload.get('ok') is True
    description = payload.get('description')
    if (good and status == 'frames_ready' and image_blocks > 0):
        state, evidence = 'frames_returned', 'low_resolution_frames'
    elif (good and status in ('analyzed', 'cached')
          and isinstance(description, str) and bool(description.strip())):
        state, evidence = 'model_description_returned', 'unverified_low_resolution_description'
    elif status in ('round_limit', 'daily_limit', 'vision_config_error', 'vision_unavailable') or payload.get('blocked') is True:
        state, evidence = 'blocked', 'none'
    else:
        state, evidence = 'failed', 'none'
    return {
        'visual_fallback': state,
        'visual_evidence': evidence,
        'vision_status': status,
        'preview_images_returned': image_blocks if state == 'frames_returned' else 0,
        'can_claim_full_video_watched': False,
        'can_claim_audio_listened': False,
    }
