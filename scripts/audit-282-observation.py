#!/usr/bin/env python3
"""Read-only, redacted Life video acceptance audit from a DSH exported log ZIP.

Usage: python scripts/audit-282-observation.py PATH_TO_LOGS.zip
No network, no state changes, and no private message content or BV identifiers.
"""
import argparse
import collections
import datetime
import json
import pathlib
import sys
import zipfile


def date_from_ms(value):
    try:
        ms = int(value)
        if not 1_500_000_000_000 < ms < 2_500_000_000_000:
            return '未知'
        return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).astimezone(
            datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')
    except (ValueError, TypeError, OverflowError, OSError):
        return '未知'


def _read_json(z, name):
    try:
        info = z.getinfo(name)
        if info.file_size > 2_000_000:
            return None
        return json.loads(z.read(info))
    except (KeyError, ValueError, UnicodeError):
        return None


def audit(path):
    with zipfile.ZipFile(path) as z:
        recent = _read_json(z, '_diagnostics/video-agent-decision-timeline.json') or {}
        rounds = _read_json(z, '_diagnostics/video-agent-rounds.json') or {}
        timeline = recent.get('recent') if isinstance(recent.get('recent'), list) else []
        actions = collections.Counter()
        blocks = collections.Counter()
        offered = 0
        for entry in timeline:
            if not isinstance(entry, dict):
                continue
            offered += bool(entry.get('offeredVideoHome') or entry.get('offeredVideoAgent'))
            for choice in entry.get('choices', []):
                if not isinstance(choice, dict):
                    continue
                typ, action = choice.get('type'), choice.get('action')
                if action == 'observe_video' and typ == 'model-choice':
                    actions['life_chose_frames'] += 1
                elif action == 'observe_video' and typ == 'action-result':
                    if choice.get('result') == 'visual-read-verified':
                        actions['frames_receipt_verified'] += 1
                    else:
                        actions['other_visual_result'] += 1
                elif typ == 'blocked':
                    code = str(choice.get('code') or '')
                    if code.startswith(('visual-', 'video-visual-', 'video-already-', 'video-')):
                        blocks[code[:60]] += 1
                elif typ == 'error' and choice.get('code') == 'model-call-failed':
                    actions['model_call_failed'] += 1
        dates = []
        lines = 0
        for name in z.namelist():
            if name.startswith('vision-events/') and name.endswith('.jsonl') and '/' not in name[len('vision-events/'):]:
                try:
                    data = z.read(name)
                    if len(data) > 5_000_000:
                        continue
                    for line in data.splitlines():
                        event = json.loads(line)
                        if isinstance(event, dict):
                            lines += 1
                            at = str(event.get('time') or '')[:19]
                            if at and event.get('ok') is True and event.get('status') == 'frames_ready':
                                dates.append(at)
                except (ValueError, UnicodeError):
                    continue
        complete = sum(r.get('state') == 'completed' for r in rounds.get('recentRounds', []) if isinstance(r, dict))
        return {
            'vision_events_count': lines,
            'last_frame_ready_event': max(dates) if dates else '无',
            'decision_records': len(timeline),
            'video_offered_records': offered,
            'life_chose_frames': actions['life_chose_frames'],
            'frames_receipt_verified': actions['frames_receipt_verified'],
            'model_call_failed': actions['model_call_failed'],
            'visual_block_codes': dict(sorted(blocks.items())),
            'recent_video_rounds_completed': complete,
            'last_life_decision_at': date_from_ms(timeline[-1].get('at')) if timeline else '未知',
        }


def main(argv=None):
    parser = argparse.ArgumentParser(description='离线分析 DSH 视频画面观察回执（只读、脱敏）')
    parser.add_argument('zipfile', type=pathlib.Path, help='从 DSH 导出的 bili-duty-logs-*.zip')
    args = parser.parse_args(argv)
    if not args.zipfile.is_file():
        parser.error('日志 ZIP 不存在')
    try:
        summary = audit(args.zipfile)
    except (zipfile.BadZipFile, OSError) as e:
        parser.error('日志压缩包无法读取：' + type(e).__name__)
    print('大肥鱼 2.8.2 视频观察离线核查（只读，不接触平台）')
    translations = {
        'vision_events_count': '旧视觉事件条数',
        'last_frame_ready_event': '旧视觉事件最后成功日期',
        'decision_records': '近期 Life 决策记录条数',
        'video_offered_records': '近期含视频候选的轮次数',
        'life_chose_frames': 'Life 选择实际看画面的次数',
        'frames_receipt_verified': '当前决策记录中可信画面回执次数',
        'model_call_failed': '模型调用失败次数',
        'visual_block_codes': '画面观察技术阻断分类',
        'recent_video_rounds_completed': '最近视频 Agent 完成轮次',
        'last_life_decision_at': '最近 Life 决策时间',
    }
    for key, name in translations.items():
        value = summary[key]
        if isinstance(value, dict):
            value = '、'.join(f'{k}={v}' for k, v in value.items()) or '无'
        print(f'{name}：{value}')
    print('说明：视觉事件日志可能不覆盖所有新入口；只有真实取帧和模型证据回执才能证明已观察。')
    if summary['visual_block_codes']:
        print('诊断：存在已选择观察、但未完成回执的轮次；请连同原始日志交开发者定位。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
