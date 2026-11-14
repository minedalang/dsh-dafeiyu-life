@echo off
setlocal
set "BILI_EXPORT_SCRIPT=%~f0"
set "BILI_EXPORT_DIR=%~dp0"
set "BILI_EXPORT_STATUS_URL="
set "BILI_EXPORT_NO_PAUSE=0"
set "BILI_EXPORT_PYTHON_ARG="
set "BILI_EXPORT_STRICT=0"
:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--strict" (
  set "BILI_EXPORT_STRICT=1"
  shift
  goto parse_args
)
if /I "%~1"=="--no-pause" (
  set "BILI_EXPORT_NO_PAUSE=1"
  shift
  goto parse_args
)
if /I "%~1"=="--python" (
  if "%~2"=="" (echo Missing interpreter path after --python & exit /b 2)
  set "BILI_EXPORT_PYTHON_ARG=%~2"
  shift
  shift
  goto parse_args
)
if /I "%~1"=="--status-url" (
  if "%~2"=="" (echo Missing URL after --status-url & exit /b 2)
  set "BILI_EXPORT_STATUS_URL=%~2"
  shift
  shift
  goto parse_args
)
echo Unsupported argument: %~1
echo Usage: %~nx0 [--strict] [--no-pause] [--python "C:\path\to\python.exe"] [--status-url http://127.0.0.1:PORT/api/bili-duty/status]
exit /b 2
:args_done
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $s=[IO.File]::ReadAllText($env:BILI_EXPORT_SCRIPT,[Text.Encoding]::UTF8); $marker='# POWERSHELL_PAYLOAD_BEGIN'; $i=$s.LastIndexOf($marker); if($i -lt 0){throw 'Missing payload marker'}; Invoke-Expression $s.Substring($i+$marker.Length)"
set "RESULT=%ERRORLEVEL%"
if "%BILI_EXPORT_NO_PAUSE%"=="0" pause
exit /b %RESULT%
# POWERSHELL_PAYLOAD_BEGIN
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:USERPROFILE '.dsh\bili-duty'
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Source directory not found: $root" }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$dest = Join-Path $env:BILI_EXPORT_DIR ("bili-duty-logs-{0}.zip" -f $stamp)
if (Test-Path -LiteralPath $dest) { throw "Archive already exists: $dest" }
$errors = New-Object 'System.Collections.Generic.List[string]'
$warnings = New-Object 'System.Collections.Generic.List[string]'
$scanErrors = @()
$count = 0
$work = Join-Path $env:TEMP ('dafeiyu-export-' + [Guid]::NewGuid().ToString('N'))
$helper = Join-Path $work 'diagnostic_helper.py'
$generated = Join-Path $work 'collected'
$diagCompleted = $false
$coverageComplete = $false
$usedPython = ''
New-Item -ItemType Directory -Path $generated -Force | Out-Null
try {
  $pythonBody = @'
# Embedded standard-library helper for the standalone Windows batch exporter.
# No network/model/platform writes. Raw private content is never included in summaries.
import collections
from contextlib import closing
import datetime as dt
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from urllib.parse import urlparse
from urllib.request import build_opener, ProxyHandler, Request

root = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
status_url = (sys.argv[3] if len(sys.argv) > 3 else '').strip()
out.mkdir(parents=True, exist_ok=True)
(diag := out / '_diagnostics').mkdir(parents=True, exist_ok=True)


def dump(name, obj):
    (diag / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def read_json(path, limit=1500000):
    try:
        path = Path(path)
        if not path.is_file() or path.stat().st_size > limit:
            return None
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError, UnicodeError):
        return None


def code(value):
    if not isinstance(value, str) or len(value) > 76 or not re.fullmatch(r'[A-Za-z0-9._-]+', value):
        return None
    return value


def number(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < 10**15 else None


def pick(obj, keys):
    return {key: val for key in keys if isinstance(obj, dict) and (val := obj.get(key)) is not None and isinstance(val, (int, bool, float))}


# Only names/counts/codes, never the prompt, private text, UID, video ID or full config.
config_keys = ['masterEnabled', 'autonomousPlannerEnabled', 'lifeAgentMode',
    'autonomousPlannerMinutes', 'autonomousPlannerDailyLimit', 'autonomousPlannerStartHour',
    'autonomousPlannerEndHour', 'videoAgentMinIntervalMinutes',
    'videoAgentReadTargetPerRound', 'videoAgentPickTargetPerRound',
    'homeRecommendationsEnabled', 'autoVideoLike', 'autoVideoCollect',
    'autoComment', 'commentPerRound', 'commentDailyLimit', 'agentFollowEnabled',
    'commentWatchReplies', 'socialAutoSend', 'dmWatch', 'dmWatchMinutes',
    'dmActivePollEnabled', 'dmActivePollSeconds', 'dmActiveWindowSeconds',
    'dmP6Enabled', 'dmP6MaxBubbles', 'ownerDmAgentEnabled', 'ownerSpontaneousChatEnabled']


def safe_config(d):
    return {k: v for k in config_keys if (v := (d or {}).get(k)) is not None
            and (isinstance(v, bool) or isinstance(v, int) or k == 'lifeAgentMode' and v in ('active','shadow','off'))}


cfg = read_json(root/'config.json')
override = read_json(root/'local-override.json')
snapshot = {'sources': {'configFilePresent': (root/'config.json').is_file(),
                        'localOverridePresent': (root/'local-override.json').is_file()},
            'persistedConfig': safe_config(cfg),
            'localOverride': safe_config(override),
            'warning': 'Persisted/override fields are not proof of final host-resolved config; use --status-url for live authoritative values.'}

duty = read_json(root/'state.json')
snapshot['videoDutyState'] = pick(duty, ['count','lastRunAt','lastWhy','day'])
# The current day is a string and lastWhy is a closed enum-ish source. Never copy free text.
if isinstance(duty, dict):
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(duty.get('day',''))):
        snapshot['videoDutyState']['day'] = duty['day']
    x = code(duty.get('lastWhy'))
    if x: snapshot['videoDutyState']['lastWhy'] = x

planner = read_json(root/'autonomous-planner.json')
snapshot['planner'] = pick(planner,['runs','lifeRuns','socialRuns','willingnessRuns',
    'lastAt','modelInputChars','modelOutputChars','modelFailureStreak','modelRetryAt','modelFailureAt'])
if isinstance(planner, dict):
    for k in ['lastResult','modelFailureCode']:
        x = code(planner.get(k))
        if x: snapshot['planner'][k] = x
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(planner.get('day',''))):
        snapshot['planner']['day'] = planner['day']
    recent = planner.get('recent', [])
    snapshot['planner']['recentDecisions'] = [dict(
        (k, v) for k in ['at','action','result','status','code','mode','reason','blocked']
        if (v := x.get(k)) is not None and (number(v) is not None or code(v) is not None))
        for x in recent[-20:] if isinstance(x, dict)] if isinstance(recent, list) else []
dump('life-video-launch-state.json', snapshot)

life_file = root/'life-agent-events'
rounds=[]
if life_file.is_dir():
    for f in sorted(life_file.glob('*.json'))[:20]:
        d = read_json(f)
        if isinstance(d, dict) and isinstance(d.get('videoRounds'), list):
            for x in d['videoRounds']:
                if not isinstance(x, dict):continue
                row=pick(x,['startedAt','endedAt','pickedCount','exitCode','readTarget','pickTarget'])
                for k in ['source','state','entryMode','commentGate']:
                    v=code(x.get(k))
                    if v:row[k]=v
                comment=x.get('commentDiagnostics',{})
                row['comment']=pick(comment,['reviewed','wanted','passed','insufficient','reviewRejected',
                    'reviewAttempted','reviewDeferred','reviewBlocked','proposed','approved',
                    'blocked','declined','verified','unverified'])
                for k in ('lastReason','selectionLedgerCode'):
                    val=code(comment.get(k)) if isinstance(comment, dict) else None
                    if val: row['comment'][k]=val
                rounds.append(row)
video_diag={'roundsRecorded':len(rounds),
            'sourceStateCounts':dict(collections.Counter((r.get('source','?')+'/'+r.get('state','?')) for r in rounds)),
            'recentRounds':sorted(rounds,key=lambda x:x.get('startedAt',0))[-20:]}
dump('video-agent-rounds.json',video_diag)

trace_rows=[]
video_home_offered=0
video_home_selected=0
comment_menu_count=0
comment_selected_count=0
comment_non_offer=collections.Counter()
comment_choice=collections.Counter()
trace_root=root/'life-decision-traces'
if trace_root.is_dir():
    for f in trace_root.glob('*/*.json'):
        d=read_json(f,800000)
        if not isinstance(d,dict):continue
        row=pick(d,['at','updatedAt'])
        for k in ('mode','state','trigger'):
            v=code(d.get(k))
            if v:row[k]=v
        steps=d.get('steps',[])
        if not isinstance(steps,list):steps=[]
        row['stepKinds']=dict(collections.Counter(s.get('type') for s in steps
                         if isinstance(s,dict) and code(s.get('type'))))
        row['offeredVideoAgent']=any('browse_home' in (s.get('menuActions') or []) or
            'use_capability' in (s.get('menuActions') or []) for s in steps if isinstance(s,dict))
        row['offeredVideoHome']=any(s.get('type')=='model-input' and 'browse_home' in (s.get('menuActions') or []) for s in steps if isinstance(s,dict))
        video_home_offered += int(row['offeredVideoHome'])
        video_home_selected += sum(s.get('type')=='model-choice' and s.get('action')=='browse_home'
            for s in steps if isinstance(s,dict))
        comment_calls=[s for s in steps if isinstance(s,dict) and s.get('type')=='model-call'
            and s.get('action')=='life-continuation']
        row['offeredCommentMenus']=sum('comment_video' in (s.get('menuActions') or []) for s in comment_calls)
        comment_menu_count += row['offeredCommentMenus']
        comment_selected_count += sum(s.get('type')=='model-choice' and s.get('modelScene')=='life-continuation'
            and s.get('action')=='comment_video' for s in steps if isinstance(s,dict))
        for s in comment_calls:
            if s.get('commentNotOfferedCode'):
                v=code(s.get('commentNotOfferedCode'))
                if v:comment_non_offer[v]+=1
        for s in steps:
            if isinstance(s,dict) and s.get('type')=='candidate-detail' and s.get('kind')=='life-original-comment':
                v=code(s.get('code'))
                if v:comment_choice[v]+=1
        row['commentNotOfferedCodes']=[code(s.get('commentNotOfferedCode')) for s in comment_calls
            if code(s.get('commentNotOfferedCode'))]
        row['commentDecisionCodes']=[code(s.get('code')) for s in steps
            if isinstance(s,dict) and s.get('type')=='candidate-detail' and
            s.get('kind')=='life-original-comment' and code(s.get('code'))]
        row['videoDelegationCodes']=[code(s.get('code')) for s in steps
            if isinstance(s,dict) and s.get('type')=='candidate-detail' and
            s.get('kind')=='video-delegation' and code(s.get('code'))]
        row['offeredOriginalComment']=any('comment_video' in (s.get('menuActions') or []) for s in steps if isinstance(s,dict))
        row['choices']=[dict((k,v) for k in ('type','action','result','code','state','delivery')
                       if (v:=code(s.get(k))) is not None)
                        for s in steps if isinstance(s,dict) and s.get('type') in
                        ('model-choice','action-result','delegation-result','execution-result','blocked','error')][-10:]
        trace_rows.append(row)
trace_rows.sort(key=lambda x:x.get('at',0))
dump('life-decision-overview.json',{
    'traceFiles':len(trace_rows),
    'traceStates':dict(collections.Counter(x.get('state','?') for x in trace_rows)),
    'offeredVideoAgent':sum(bool(x['offeredVideoAgent']) for x in trace_rows),
    'offeredVideoHome':video_home_offered,'selectedVideoHome':video_home_selected,
    'offeredOriginalCommentMenus':comment_menu_count,
    'selectedOriginalComment':comment_selected_count,
    'originalCommentNotOfferedReasons':dict(comment_non_offer),
    'originalCommentChoiceOutcomes':dict(comment_choice),
    'offeredOriginalComment':sum(bool(x['offeredOriginalComment']) for x in trace_rows),
    'recentTraces':trace_rows[-60:]})


# Explicit causal timelines: an offered action != a chosen action != a verified send.
def public_choices(row, allowed_types):
    return [x for x in row.get('choices', []) if x.get('type') in allowed_types]

def clean_timeline_item(row):
    return {'at': row.get('at'), 'state': row.get('state'),
        'offeredVideoAgent': row.get('offeredVideoAgent'),
        'offeredVideoHome': row.get('offeredVideoHome'),
        'offeredOriginalComment': row.get('offeredOriginalComment'),
        'offeredCommentMenus': row.get('offeredCommentMenus'),
        'commentNotOfferedCodes':row.get('commentNotOfferedCodes'),
        'commentDecisionCodes':row.get('commentDecisionCodes'),
        'videoDelegationCodes':row.get('videoDelegationCodes'),
        'choices':row.get('choices',[])}

dump('video-agent-decision-timeline.json', {
    'counts':{'videoOfferedTraces':sum(x.get('offeredVideoAgent',False) for x in trace_rows),
      'homeOfferedTraces':sum(x.get('offeredVideoHome',False) for x in trace_rows),
      'homeChosenTraces':sum(any(c.get('action')=='browse_home' for c in x.get('choices',[]))
                             for x in trace_rows),
      'videoDelegationReasonCodes':dict(collections.Counter(code0 for x in trace_rows
           for code0 in x.get('videoDelegationCodes',[]) if code0))},
    'recent': [clean_timeline_item(x) for x in trace_rows[-60:]],
    'note':'Use videoRounds and live/persisted launch state separately to distinguish model choice from actual subprocess start.'})
dump('life-comment-decision-timeline.json', {
    'counts':{'offeredMenus':comment_menu_count,'chosenComment':comment_selected_count,
      'notOfferedCodes':dict(comment_non_offer),'decisionCodes':dict(comment_choice)},
    'recent':[clean_timeline_item(x) for x in trace_rows[-60:] if
          x.get('offeredCommentMenus') or x.get('commentDecisionCodes') or x.get('commentNotOfferedCodes')],
    'note':'Menu exposure alone is not a send. Correlate separately with outbound-action-executions receipts and video-actions ledger.'})

# Counts from the real log lines. Never export raw matched lines into summaries.
log_stats={'coveredFiles':[],'videoLaunchClues':{},'commentReviewRoundOutcomes':{},
           'dmNetworkErrors':{},'warning': 'Counts are matching log lines, not distinct requests or confirmed actions.'}
patterns={'video-agent-stop-or-off':'总开关关闭.*视频|视频.*启动.*暂停|视频.*未启动',
          'video-agent-technical-failure':'overlay 创建失败|拒绝启动刷视频|video-agent-busy|video-launch-cooldown|video-busy',
          'comment-review':'本轮原创主评论诊断：([A-Za-z0-9._-]+)',
          'dm-rate-limit':r'(?i)(私信|DM poll).*(-509|请求过于频繁)',
          'dm-dns-error':r'(?i)(私信|DM poll).*ENOTFOUND',
          'dm-lock':'DM poll skipped: lock exists'}
counts=collections.Counter();comment_counts=collections.Counter()
for f in [root/'duty.log',root/'duty.log.1']:
    if not f.is_file():continue
    log_stats['coveredFiles'].append(f.name)
    try:
        with f.open(encoding='utf-8',errors='replace') as h:
            for line in h:
                for key,pat in patterns.items():
                    m=re.search(pat,line)
                    if not m:continue
                    counts[key]+=1
                    if key=='comment-review':
                        codeval=m.group(1)
                        if code(codeval):comment_counts[codeval]+=1
    except OSError:pass
log_stats['videoLaunchClues']={k:v for k,v in counts.items() if k.startswith('video-')}
log_stats['commentReviewRoundOutcomes']=dict(comment_counts)
log_stats['dmNetworkErrors']={k:v for k,v in counts.items() if k.startswith('dm-')}
dump('log-observation-counts.json',log_stats)

# Actual per-turn model generation stages are not persisted in dev16.
people=[]; owners=[]; accountdir=root/'accounts'
if accountdir.is_dir():
    for acct in accountdir.iterdir():
        if not acct.is_dir():continue
        d=read_json(acct/'runtime'/'dm-autoreply-state.json')
        if isinstance(d,dict):
            p=d.get('p6LastTurn',{})
            if isinstance(p,dict):
                row=pick(p,['at','proposed','planned','confirmed'])
                for k in ['status','reason','reconsideration','postSendStage']:
                    v=code(p.get(k))
                    if v:row[k]=v
                people.append(row)
        own=read_json(acct/'runtime'/'owner-dm-agent.json')
        if isinstance(own,dict) and isinstance(own.get('items'),list):
            stats=collections.Counter(code(item.get('status')) or 'unknown' for item in own['items'] if isinstance(item,dict))
            recent=[]
            for item in own['items'][-12:]:
                if not isinstance(item,dict):continue
                row=pick(item,['at','proposedBubbles','confirmedBubbles'])
                v=code(item.get('status'))
                if v:row['status']=v
                phase=code(item.get('postSendStage'))
                if phase:row['postSendStage']=phase
                recent.append(row)
            owners.append({'statusCounts':dict(stats),'recent':recent})
dump('dm-expression-overview.json',{
    'normalLastTurnByAccount':people,'ownerAgentByAccount':owners,
    'knownUnobservableFromDisk':[
      'Whether the additional bubble was pre-written or generated AFTER the first receipt',
      'Every 10-second fast-poll dispatch and its in-memory process counter',
      'Actual model prompts and replies are intentionally not re-exported'],
    'liveStatusHint':'Optional --status-url http://127.0.0.1:PORT/api/bili-duty/status'})


# Natural conversation (including silence, proactive topic starts and progressive bubbles).
# Aggregate only whitelisted codes/numbers. Never include private message text.
owner_comment_stats=collections.Counter();owner_dm_stats=collections.Counter()
spontaneous_stats=collections.Counter();progressive_phases=collections.Counter()
normal_turn_states=collections.Counter();normal_progressive=collections.Counter()
normal_turns=0;owner_turns=0
inbox_cursor_count=0;network_backoff_states=collections.Counter()
if accountdir.is_dir():
    for acct in accountdir.iterdir():
        if not acct.is_dir():continue
        runtime=acct/'runtime'
        own=read_json(runtime/'owner-dm-agent.json',5_000_000)
        if isinstance(own,dict) and isinstance(own.get('items'),list):
            for item in own.get('items',[]):
                if not isinstance(item,dict):continue
                owner_turns+=1
                st=code(item.get('status'))
                if st:owner_dm_stats[st]+=1
                stage=code(item.get('postSendStage'))
                if stage:progressive_phases[stage]+=1
                typ=code(item.get('kind')) or code(item.get('type'))
                if typ and ('spontan' in typ or 'initiative' in typ or 'silence' in typ):
                    spontaneous_stats[typ]+=1
            for name in ('lastCompleted','lastSearch','lastDraft'):
                if isinstance(own.get(name),int):spontaneous_stats[name+'-recorded']+=1
        comments=read_json(runtime/'owner-comment-agent.json',5_000_000)
        if isinstance(comments,dict) and isinstance(comments.get('items'),list):
            for item in comments.get('items',[]):
                if isinstance(item,dict):
                    st=code(item.get('replyStatus')) or code(item.get('status'))
                    if st:owner_comment_stats[st]+=1
        normal=read_json(runtime/'dm-autoreply-state.json',5_000_000)
        if isinstance(normal,dict):
            last=normal.get('p6LastTurn')
            if isinstance(last,dict):
                normal_turns+=1
                st=code(last.get('status'))
                if st:normal_turn_states[st]+=1
                stage=code(last.get('postSendStage'))
                if stage:normal_progressive[stage]+=1
            if isinstance(normal.get('people'),dict):
                spontaneous_stats['knownDmConversations']+=len(normal['people'])
        if read_json(runtime/'dm-poll-cursor.json') is not None:inbox_cursor_count+=1
        backoff=read_json(runtime/'interaction-network-backoff.json')
        if isinstance(backoff,dict):
            for name in ('dm','mentions','replies'):
                item=backoff.get(name)
                if isinstance(item,dict):
                    st=code(item.get('reason')) or code(item.get('state'))
                    if st:network_backoff_states[name+'/'+st]+=1

life_actions=collections.Counter()
life_choice_scenes=collections.Counter()
for row in trace_rows:
    for event in row.get('choices',[]):
        if event.get('type')=='model-choice' and code(event.get('action')):
            life_actions[event['action']]+=1
            if code(event.get('modelScene')):
                life_choice_scenes[event['modelScene']]+=1
owner_silence_review=collections.Counter()
if accountdir.is_dir():
    for acct in accountdir.iterdir():
        own=read_json(acct/'runtime'/'owner-dm-agent.json')
        if isinstance(own,dict) and isinstance(own.get('silenceReview'),dict):
            status=code(own['silenceReview'].get('status'))
            if status:owner_silence_review[status]+=1

dump('natural-chat-diagnostics.json',{
    'lifeChoiceCounts':dict(life_actions),
    'ownerSilenceReviewStatus':dict(owner_silence_review),
    'ownerDmRecordCount':owner_turns,'ownerDmStatuses':dict(owner_dm_stats),
    'normalDmLastTurnRecords':normal_turns,'normalDmLastTurnStatuses':dict(normal_turn_states),
    'ownerCommentReplyStatuses':dict(owner_comment_stats),
    'ownerProgressiveStages':dict(progressive_phases),
    'normalProgressiveStages':dict(normal_progressive),
    'spontaneousActivityHints':dict(spontaneous_stats),
    'dmPollCursorAccountCount':inbox_cursor_count,
    'dmNetworkBackoffStates':dict(network_backoff_states),
    'notProofOf':['Naturalness or coherence of reply text','Model privately considered a new topic',
                  'A post-send bubble was generated on older builds lacking stage fields'],
    'source':'Per-account runtime records, not separate DM permission or platform send receipts'})

# Model usage counts and polling can be influenced by rest, budgets, network and backoff.
model_files=list((root/'model-invocations').glob('*.jsonl')) if (root/'model-invocations').is_dir() else []
usage_files=list((root/'model-usage').glob('*.jsonl')) if (root/'model-usage').is_dir() else []
usage_counts={'modelInvocationFiles':len(model_files),'modelUsageFiles':len(usage_files)}
for k,files in [('modelInvocations',model_files),('modelUsage',usage_files)]:
    usage_counts[k+'LogLines']=0
    for f in files[:30]:
        try:
            with f.open('rb') as h:usage_counts[k+'LogLines']+=sum(1 for _ in h)
        except OSError:pass
# Summarize real model routing outcomes without prompts, person IDs or text.
model_scenes=collections.Counter();model_errors=collections.Counter();model_results=collections.Counter()
model_slow=collections.Counter();model_duration=[]
for f in model_files[:30]:
    try:
        with f.open(encoding='utf-8',errors='replace') as h:
            for line in h:
                if len(line)>16384:continue
                try:d=json.loads(line)
                except ValueError:continue
                if not isinstance(d,dict):continue
                scene=code(d.get('scene'))
                if scene:model_scenes[scene]+=1
                result_code=code(d.get('result'))
                if result_code:model_results[result_code]+=1
                err=code(d.get('errorKind'))
                if err and err not in ('none','ok'):model_errors[err]+=1
                duration=number(d.get('durationMs'))
                if duration is not None:
                    model_duration.append(duration)
                    if duration>=30000:model_slow[scene or 'unknown']+=1
    except OSError:pass
usage_tasks=collections.Counter()
for f in usage_files[:30]:
    try:
        with f.open(encoding='utf-8',errors='replace') as h:
            for line in h:
                if len(line)>16384:continue
                try:d=json.loads(line)
                except ValueError:continue
                task=code(d.get('task')) if isinstance(d,dict) else None
                if task:usage_tasks[task]+=1
    except OSError:pass
# A count is not a successful call or token figure; raw usage logs are in the ZIP.
dump('polling-and-model-budget.json',{
    **usage_counts,'modelScenes':dict(model_scenes),
    'modelResults':dict(model_results),'modelErrors':dict(model_errors),
    'modelLongCallsOver30SecondsByScene':dict(model_slow),
    'modelDurationMsP95':sorted(model_duration)[int((len(model_duration)-1)*.95)] if model_duration else None,
    'usageLogTaskCounts':dict(usage_tasks),
    'dmPollCursorAccounts':inbox_cursor_count,
    'dmBackoffReasons':dict(network_backoff_states),
    'liveFastPollCountersRequireStatusUrl':True,
    'note':'The original model-usage and model-invocations logs are preserved for detailed timeout/cost tracing.'})

# Capture authorized live status only when the user explicitly supplies a local URL.
# Never save raw status: it includes credentials/config/persona/UID.
live_info={'requested':bool(status_url),'captured':False,'reason':'no-local-status-url-provided'}
if status_url:
    try:
        u=urlparse(status_url)
        if (u.scheme!='http' or u.hostname not in ('localhost','127.0.0.1','::1') or
            u.path!='/api/bili-duty/status' or u.username or u.password or u.query or u.fragment):
            raise ValueError('URL must be a loopback http /api/bili-duty/status endpoint')
        if u.port is None or u.port<1 or u.port>65535:raise ValueError('Invalid local port')
        opener=build_opener(ProxyHandler({}))
        with opener.open(Request(status_url,headers={'Accept':'application/json'}),timeout=3) as resp:
            blob=resp.read(2_000_001)
        if len(blob)>2_000_000:raise ValueError('Status response exceeds size limit')
        d=json.loads(blob)
        if not isinstance(d,dict) or d.get('ok') is not True:
            raise ValueError('Not a ready plugin status response')
        scheduler=d.get('interactionSchedulerStatus',{}) or {}
        dm=d.get('dmAutoReplyStatus',{}) or {}
        fast=scheduler.get('activeDm') or dm.get('fast') or {}
        checks=scheduler.get('checks') or {}
        live={'capturedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
              'configuration':safe_config(d.get('config')),
              'videoDuty':pick(d,['lastRunAt','ranToday','pickedToday','loggedIn']),
              'fastDm':pick(fast,['activeCount','lastFastAt','checks','enabled']),
              'pollChecks':{k:dict(pick(v,['lastStartedAt','lastFinishedAt','polling','intervalMinutes']),
                         lastResult=code(v.get('lastResult')) or 'unclassified')
                            for k,v in checks.items() if k in ('dm','dmFast','replies','mentions') and isinstance(v,dict)},
              'readBudget':pick((scheduler.get('readBudget') or {}),['minuteLimit','minuteUsed','hourLimit','hourUsed','blocked','retryAt'])}
        dump('live-status-snapshot.json',live)
        live_info={'requested':True,'captured':True,'reason':'ok'}
    except Exception as e:
        live_info={'requested':True,'captured':False,'reason':type(e).__name__}
        # No private network response or source path in the manifest.
dump('live-status-availability.json',live_info)

# Online SQLite backup. Direct copies of a live .sqlite3/-wal/-shm combination
# are NEVER assumed to be consistent and are deliberately skipped by PowerShell.
manifest=[]
files=[]
# The important databases are not all account-scoped. Scan the STATE tree,
# excluding dependency/cache directories, and backup every genuine business DB.
# Do not traverse symlinked directories or copied backup/installer folders.
skip_dirs={'node_modules','.git','.venv','.cache','uv-cache','uv-python',
           'embedding-runtime','projects','backups','backup','tmp','temp'}
for base,dirs,filenames in os.walk(root,followlinks=False):
    dirs[:]=[x for x in dirs if x.lower() not in skip_dirs and
             not x.lower().startswith('backup-before-reinstall') and
             not (Path(base)/x).is_symlink()]
    for filename in filenames:
        if not filename.lower().endswith(('.sqlite','.sqlite3','.db')):continue
        path=Path(base)/filename
        if not path.is_symlink():files.append(path)
for src in sorted(set(files)):
    relative=src.relative_to(root)
    dest=(out/'sqlite-snapshots'/relative)
    dest.parent.mkdir(parents=True,exist_ok=True)
    row={'path':str(relative).replace('\\','/'),'status':'failed','integrityCheck':'not-run'}
    for attempt in range(3):
        try:
            if dest.exists():dest.unlink()
            source_uri=src.resolve().as_uri()+'?mode=ro'
            with closing(sqlite3.connect(source_uri,uri=True,timeout=4)) as source:
                source.execute('PRAGMA busy_timeout = 4000')
                with closing(sqlite3.connect(str(dest),timeout=4)) as target:
                    source.backup(target,pages=64,sleep=0.1)
                    check=target.execute('PRAGMA integrity_check').fetchone()
                    if not check or check[0]!='ok':
                        raise ValueError('SQLite integrity check failed')
            row.update(status='ok',integrityCheck='ok',bytes=dest.stat().st_size,
                       snapshotArchivePath=str(relative).replace('\\','/'))
            break
        except (OSError,sqlite3.DatabaseError,ValueError) as ex:
            row.update(status='failed',errorClass=type(ex).__name__)
            try:dest.unlink()
            except OSError:pass
            time.sleep(.25)
    manifest.append(row)
dump('sqlite-snapshot-manifest.json',{
    'method':'Python sqlite3 online backup, integrity_check; main db, WAL and SHM are not copied independently',
    'databaseCount':len(manifest),'successCount':sum(x['status']=='ok' for x in manifest),
    'databaseStatuses':manifest})

# Enumerate evidence in terms of questions this archive can and cannot answer.
# Missing sources do NOT become synthetic success or a fabricated root cause.
source_counts={
    'dutyLog':sum((root/name).is_file() for name in ('duty.log','duty.log.1')),
    'lifeTraces':len(trace_rows),
    'lifeVideoRounds':len(rounds),
    'modelInvocationFiles':len(model_files),
    'modelUsageFiles':len(usage_files),
    'outboundReceiptFiles':len(list((root/'outbound-action-executions').rglob('*.json')))
          if (root/'outbound-action-executions').is_dir() else 0,
    'readExecutionFiles':len(list((root/'read-action-executions').rglob('*.json')))
          if (root/'read-action-executions').is_dir() else 0,
    'normalDmLastTurnStates':normal_turns,
    'ownerDmRecords':owner_turns,
    'ownerCommentRecords':sum(owner_comment_stats.values()),
    'sqliteDatabasesDetected':len(files),
    'sqliteDatabasesSnapshotVerified':sum(row['status']=='ok' for row in manifest),
}
critical_dbs={'video-actions':[],'public-comment-quota':[],
              'relationship-channels':[],'social-relationships':[]}
for db in manifest:
    path=db['path'].lower()
    if 'video-actions' in path:critical_dbs['video-actions'].append(db)
    if 'public-comment-quota' in path:critical_dbs['public-comment-quota'].append(db)
    if 'relationship-channels' in path:critical_dbs['relationship-channels'].append(db)
    if 'social-relationships' in path:critical_dbs['social-relationships'].append(db)
db_health={name:{'found':len(rows),'snapshotsOk':sum(row['status']=='ok' for row in rows),
             'status':'not-found' if not rows else
                      'complete' if all(row['status']=='ok' for row in rows) else 'failed'}
           for name,rows in critical_dbs.items()}
readiness={
 'videoAgentNotInvoked':{'decisionEvidence':bool(trace_rows),'roundEvidence':bool(rounds),
                        'schedulerLiveStatus':live_info['captured'],
                        'canDistinguishNotChosenVsLaunchFailure':bool(trace_rows and rounds),
                        'currentRuntimeGateProof':live_info['captured']},
 'originalMainCommentNotSent':{'decisionEvidence':bool(trace_rows),
                        'platformReceiptEvidence':source_counts['outboundReceiptFiles']>0,
                        'videoActionLedger':db_health['video-actions']['status'],
                        'quotaLedger':db_health['public-comment-quota']['status']},
 'naturalConversation':{'normalDmTurnState':normal_turns>0,
                        'ownerDmHistory':owner_turns>0,
                        'ownerCommentHistory':source_counts['ownerCommentRecords']>0,
                        'progressivePostSendStagesAvailable':bool(progressive_phases or normal_progressive),
                        'liveFastPollState':live_info['captured'],
                        'messageTextQualityNeedsAuthorizedPrivateReview':True}}
partial=[]
if not trace_rows:partial.append('life-decision-traces-missing')
if not rounds:partial.append('video-round-history-missing')
if source_counts['outboundReceiptFiles']==0:partial.append('outbound-receipts-missing')
if not (owner_turns or normal_turns):partial.append('dm-conversation-state-missing')
if not live_info['captured']:partial.append('live-scheduler-status-not-captured')
if not (progressive_phases or normal_progressive):partial.append('post-send-stage-evidence-not-yet-recorded')
for name in ('video-actions','public-comment-quota','relationship-channels','social-relationships'):
    if db_health[name]['status']!='complete':partial.append('db-'+name+'-'+db_health[name]['status'])
if any(row['status']!='ok' for row in manifest):partial.append('one-or-more-sqlite-snapshots-failed')
dump('diagnostic-coverage.json',{
    'scope':'video agent launch, original main comment, natural DM/chat and progressive continuation',
    'evidenceCounts':source_counts,'criticalDatabases':db_health,
    'perQuestion':readiness,'missingOrUnobservable':partial,
    'fullCausalCoverage':not partial,
    'notes':['This is NOT a guarantee that the software defect can be determined from one snapshot.',
      'When Life declined an action, no platform receipt should exist.',
      'Old program versions cannot retroactively supply absent model decision-stage events.',
      'Live fast-poll counters require explicitly supplying a reachable authenticated status URL.',
      'Raw ZIP may contain private messages and identifying fields: do not share publicly.']})

result={'completedAt':dt.datetime.now().astimezone().isoformat(),
        'lifePlannerFound':(root/'autonomous-planner.json').is_file(),
        'videoDutyStateFound':(root/'state.json').is_file(),
        'sqliteDatabases':len(manifest),
        'sqliteSnapshotsOk':sum(x['status']=='ok' for x in manifest),
        'missingSqliteSnapshots':[row['path'] for row in manifest if row['status']!='ok'],
        'liveStatusCaptured':live_info['captured'],
        'readme':'These are bounded diagnostics. The rest of the main archive may still contain sensitive original logs.'}
dump('export-health.json',result)
print(json.dumps({'databaseCount':len(manifest),'snapshotsOk':result['sqliteSnapshotsOk'],
                  'liveStatusCaptured':live_info['captured'],'plannerFound':result['lifePlannerFound']},ensure_ascii=False))
# Preserve all successful backups even if another DB is busy or unreadable.
# Per-database incompleteness is signaled by diagnostic-coverage.json.
sys.exit(0)
'@
  [System.IO.File]::WriteAllText($helper, $pythonBody, ([System.Text.UTF8Encoding]::new($false)))
  # Never assume `Get-Command python.exe` is an actual CPython interpreter.
  # Windows Store aliases and stale py launchers may return Windows exit 9009.
  # Prefer the exact venv already in use by this plugin, then explicit choices.
  $pythonExe = $null
  $pythonPrefix = @()
  $pythonCandidates = New-Object 'System.Collections.Generic.List[object]'
  if ($env:BILI_EXPORT_PYTHON_ARG) {
    $pythonCandidates.Add([pscustomobject]@{Exe=$env:BILI_EXPORT_PYTHON_ARG;Prefix=@()})
  }
  $pythonCandidates.Add([pscustomobject]@{Exe=(Join-Path $root '.venv\Scripts\python.exe');Prefix=@()})
  try {
    # This is a selected interpreter path, not a credential to export.
    $rawCfg = Join-Path $root 'config.json'
    if (Test-Path -LiteralPath $rawCfg -PathType Leaf) {
      $resolvedCfg = Get-Content -LiteralPath $rawCfg -Encoding UTF8 -Raw | ConvertFrom-Json
      if ($resolvedCfg.pythonPath -is [string] -and $resolvedCfg.pythonPath.EndsWith('.exe')) {
        $pythonCandidates.Add([pscustomobject]@{Exe=$resolvedCfg.pythonPath;Prefix=@()})
      }
    }
  } catch { }
  if ($env:CONDA_PREFIX) {
    $pythonCandidates.Add([pscustomobject]@{Exe=(Join-Path $env:CONDA_PREFIX 'python.exe');Prefix=@()})
  }
  # Include root-level Anaconda installs, e.g. G:\Anaconda3\python.exe.
  foreach ($drive in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    foreach ($folder in @('Anaconda3','anaconda3','Miniconda3','miniconda3')) {
      $pythonCandidates.Add([pscustomobject]@{Exe=(Join-Path $drive.Root ($folder+'\python.exe'));Prefix=@()})
    }
  }
  foreach ($folder in @('anaconda3','miniconda3','AppData\Local\Programs\Python\Python313','AppData\Local\Programs\Python\Python312','AppData\Local\Programs\Python\Python311','AppData\Local\Programs\Python\Python310')) {
    $pythonCandidates.Add([pscustomobject]@{Exe=(Join-Path $env:USERPROFILE ($folder+'\python.exe'));Prefix=@()})
  }
  # Conda in PowerShell may be a shell function with no python.exe application
  # visible to Get-Command. Follow its real prefix, then search PATH explicitly.
  if ($env:CONDA_EXE) {
    try { $pythonCandidates.Add([pscustomobject]@{Exe=(Join-Path (Split-Path (Split-Path $env:CONDA_EXE -Parent) -Parent) 'python.exe');Prefix=@()}) } catch { }
  }
  foreach ($cmd in @(Get-Command python -All -ErrorAction SilentlyContinue)) {
    if ($cmd.CommandType -eq 'Application' -and $cmd.Source) {
      $pythonCandidates.Add([pscustomobject]@{Exe=$cmd.Source;Prefix=@()})
    }
  }
  try {
    foreach ($pathLine in @(& where.exe python 2>$null)) {
      if ($pathLine -and ([string]$pathLine).Trim().EndsWith('python.exe',[StringComparison]::OrdinalIgnoreCase)) {
        $pythonCandidates.Add([pscustomobject]@{Exe=([string]$pathLine).Trim();Prefix=@()})
      }
    }
  } catch { }
  # Explicit PATH lookup avoids shell aliases and Get-Command resolution surprises.
  foreach ($pathPart in @($env:PATH -split ';')) {
    $pathPart = [string]$pathPart
    $pathPart = $pathPart.Trim().Trim('"')
    if (-not $pathPart) { continue }
    try {
      $pythonCandidates.Add([pscustomobject]@{Exe=(Join-Path $pathPart 'python.exe');Prefix=@()})
    } catch { }
  }
  # Windows Python Launcher can enumerate installations not on PATH.
  foreach ($pyCmd in @(Get-Command py.exe -All -ErrorAction SilentlyContinue)) {
    if (-not $pyCmd.Source) { continue }
    try {
      foreach ($pyLine in @(& $pyCmd.Source -0p 2>$null)) {
        # py -0p yields lines such as: -V:3.12 * C:\...\python.exe
        $match = [regex]::Match([string]$pyLine, '(?i)([A-Z]:\\[^\r\n]+?python\.exe)\s*$')
        if ($match.Success) {
          $pythonCandidates.Add([pscustomobject]@{Exe=$match.Groups[1].Value;Prefix=@()})
        }
      }
    } catch { }
  }
  foreach ($folder in @('C:\ProgramData\anaconda3','C:\ProgramData\miniconda3',
      (Join-Path $env:LOCALAPPDATA 'anaconda3'), (Join-Path $env:LOCALAPPDATA 'miniconda3'))) {
    $pythonCandidates.Add([pscustomobject]@{Exe=(Join-Path $folder 'python.exe');Prefix=@()})
  }
  foreach ($cmd in @(Get-Command python.exe -All -ErrorAction SilentlyContinue)) {
    if ($cmd.Source) { $pythonCandidates.Add([pscustomobject]@{Exe=$cmd.Source;Prefix=@()}) }
  }
  foreach ($cmd in @(Get-Command py.exe -All -ErrorAction SilentlyContinue)) {
    if ($cmd.Source) { $pythonCandidates.Add([pscustomobject]@{Exe=$cmd.Source;Prefix=@('-3')}) }
  }
  $tried = @{}
  $probeAttempts=0
  $probeMissing=0
  $probeFailed=0
  foreach ($candidate in $pythonCandidates) {
    $exe = [string]$candidate.Exe
    if (-not $exe -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { $probeMissing++;continue }
    $prefix = @($candidate.Prefix)
    $identity = $exe.ToLowerInvariant()+'|'+($prefix -join ',')
    if ($tried.ContainsKey($identity)) { continue }
    $tried[$identity]=$true
    # Run an executable-level probe, not a PowerShell alias or shell function.
    # ProcessStartInfo avoids PowerShell 5.1 treating stderr output as terminating
    # errors under $ErrorActionPreference='Stop'. Suppress absolute paths in ZIP.
    $probeAttempts++
    try {
      $startInfo = New-Object System.Diagnostics.ProcessStartInfo
      $startInfo.FileName = $exe
      $prefixArg = if ($prefix.Count -gt 0) { ($prefix -join ' ') + ' ' } else { '' }
      $startInfo.Arguments = $prefixArg + '-c "import sys,sqlite3; assert sys.version_info >= (3,8)"'
      $startInfo.UseShellExecute = $false
      $startInfo.CreateNoWindow = $true
      $startInfo.RedirectStandardOutput = $true
      $startInfo.RedirectStandardError = $true
      $proc = New-Object System.Diagnostics.Process
      $proc.StartInfo = $startInfo
      if ($proc.Start()) {
        if (-not $proc.WaitForExit(12000)) {
          try { $proc.Kill() } catch { }
          try { $proc.WaitForExit(1000) | Out-Null } catch { }
          $probeFailed++
        } else {
          $probeText = $proc.StandardOutput.ReadToEnd()
          if ($proc.ExitCode -eq 0) {
            $pythonExe=$exe; $pythonPrefix=$prefix
            $proc.Dispose()
            break
          }
          $probeFailed++
        }
      } else { $probeFailed++ }
      $proc.Dispose()
    } catch { $probeFailed++ }
  }
  if (-not $pythonExe) {
    $warnings.Add('Optional enhanced Python diagnostics unavailable: no usable Python 3.8+ with sqlite3. Primary log ZIP and PowerShell summaries continue; no SQLite snapshots.')
    Write-Warning 'Python diagnostic unavailable: run this BAT with --python "C:\path\to\python.exe" (or ensure the plugin .venv is installed).'
  } else {
    $usedPython = 'verified'
    Write-Host 'Verified Python 3.8+ and sqlite3. Creating read-only Life/video/DM diagnostics and coherent SQLite snapshots...'
    $helperArgs = @($helper, $root, $generated, [string]$env:BILI_EXPORT_STATUS_URL)
    try {
      & $pythonExe @pythonPrefix @helperArgs
      $code = $LASTEXITCODE
      if ($code -eq 0) { $diagCompleted = $true }
      else { $warnings.Add('Optional diagnostic helper failed (exit ' + $code + '). Falling back to PowerShell summaries; no SQLite snapshots.') }
    } catch {
      $warnings.Add('Optional diagnostic helper failed: ' + $_.Exception.GetType().Name)
    }
  }
  if (-not $diagCompleted) {
    $partialSqlite = Join-Path $generated 'sqlite-snapshots'
    if (Test-Path -LiteralPath $partialSqlite) { Remove-Item -LiteralPath $partialSqlite -Force -Recurse -ErrorAction SilentlyContinue }
    # PowerShell-native diagnostics keep the crucial Life launch and comment
    # evidence available even if no Python runtime can be invoked by this BAT.
    # This fallback does not and cannot snapshot active SQLite databases.
    $fallbackFolder = Join-Path $generated '_diagnostics'
    New-Item -ItemType Directory -Path $fallbackFolder -Force | Out-Null
    function ExportSafeJson([string]$name,[object]$value) {
      $target = Join-Path $fallbackFolder $name
      [IO.File]::WriteAllText($target,($value | ConvertTo-Json -Depth 12),([Text.UTF8Encoding]::new($false)))
    }
    function LoadExportJson([string]$path) {
      try {
        if (!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -gt 2000000) {return $null}
        return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
      } catch {return $null}
    }
    function PickExportProps([object]$obj,[string[]]$names) {
      $result=@{}
      if (!$obj) {return $result}
      foreach($key in $names) {
        $prop=$obj.PSObject.Properties[$key]
        if ($null -ne $prop -and ($prop.Value -is [bool] -or $prop.Value -is [int] -or $prop.Value -is [long])) {
          $result[$key]=$prop.Value
        }
      }
      return $result
    }
    try {
      $plannerState=LoadExportJson (Join-Path $root 'autonomous-planner.json')
      $videoState=LoadExportJson (Join-Path $root 'state.json')
      $rawConfig=LoadExportJson (Join-Path $root 'config.json')
      $whitelist=@('masterEnabled','autonomousPlannerEnabled','autonomousPlannerDailyLimit',
        'videoAgentMinIntervalMinutes','homeRecommendationsEnabled','autoComment',
        'commentPerRound','commentDailyLimit','dmWatch','dmWatchMinutes',
        'dmActivePollEnabled','dmActivePollSeconds','dmActiveWindowSeconds')
      $safeConfig=PickExportProps $rawConfig $whitelist
      if ($rawConfig -and $rawConfig.lifeAgentMode -in @('active','shadow','off')) {$safeConfig.lifeAgentMode=$rawConfig.lifeAgentMode}
      ExportSafeJson 'life-video-launch-state.json' @{
        diagnosticSource='powershell-fallback'; persistedConfig=$safeConfig;
        planner=(PickExportProps $plannerState @('runs','lifeRuns','socialRuns','willingnessRuns','lastAt','modelRetryAt','modelFailureStreak'));
        videoDutyState=(PickExportProps $videoState @('count','lastRunAt'));
        warning='Persisted state only, not live host-resolved config. SQLite backups not available.'
      }
      $traceCount=0; $videoOffered=0; $videoChosen=0; $commentMenuCount=0; $commentChosen=0
      $episodeResults=@{}; $recent=@()
      $traceRoot=Join-Path $root 'life-decision-traces'
      if (Test-Path -LiteralPath $traceRoot -PathType Container) {
        foreach($f in @(Get-ChildItem -LiteralPath $traceRoot -File -Recurse -Filter '*.json' -ErrorAction SilentlyContinue | Select-Object -Last 100)) {
          $trace=LoadExportJson $f.FullName
          if (!$trace -or !($trace.steps -is [array])) {continue}
          $traceCount++;$oneVideo=$false;$chosen='none';$comments=0
          foreach($step in $trace.steps) {
            if ($step.type -eq 'model-input' -and $step.menuActions -contains 'browse_home') {$oneVideo=$true}
            if ($step.type -eq 'model-choice' -and $step.action -eq 'browse_home') {$videoChosen++}
            if ($step.type -eq 'model-call' -and $step.action -eq 'life-continuation' -and $step.menuActions -contains 'comment_video') {$comments++}
            if ($step.type -eq 'model-choice' -and $step.modelScene -eq 'life-continuation' -and $step.action -eq 'comment_video') {$commentChosen++}
          }
          if ($oneVideo) {$videoOffered++}
          $commentMenuCount+=$comments
          $recent+=@{at=$trace.at;videoOffered=$oneVideo;commentMenuCount=$comments}
        }
      }
      ExportSafeJson 'life-decision-overview.json' @{
        diagnosticSource='powershell-fallback';traceFiles=$traceCount;
        offeredVideoAgent=$videoOffered;videoDelegationChoices=$videoChosen;
        offeredOriginalCommentMenus=$commentMenuCount;selectedOriginalComment=$commentChosen;
        recentTraces=@($recent | Sort-Object at | Select-Object -Last 60)
      }
      $normal=@()
      foreach ($p in @(Get-ChildItem -Path (Join-Path $root 'accounts') -Filter 'dm-autoreply-state.json' -File -Recurse -ErrorAction SilentlyContinue)) {
        $dm=LoadExportJson $p.FullName
        if ($dm -and $dm.p6LastTurn) {
          $normal+=@{lastTurn=(PickExportProps $dm.p6LastTurn @('at','proposed','planned','confirmed'));
            status=([string]$dm.p6LastTurn.status -replace '[^a-z0-9_-]','');
            postSendStage=([string]$dm.p6LastTurn.postSendStage -replace '[^a-z0-9_-]','')}
        }
      }
      $ownerStages=@{}
      foreach ($p in @(Get-ChildItem -Path (Join-Path $root 'accounts') -Filter 'owner-dm-agent.json' -File -Recurse -ErrorAction SilentlyContinue)) {
        $owner=LoadExportJson $p.FullName
        if(!$owner) {continue}
        foreach ($item in @($owner.items)) {
          if(!$item -or !$item.postSendStage) {continue}
          $phase=([string]$item.postSendStage -replace '[^a-z0-9_-]','')
          if($phase -and $phase.Length -le 45) {
            if(!$ownerStages.ContainsKey($phase)) {$ownerStages[$phase]=0}
            $ownerStages[$phase]++
          }
        }
      }
      ExportSafeJson 'dm-expression-overview.json' @{
        diagnosticSource='powershell-fallback';normalLastTurnByAccount=$normal;
        ownerProgressiveStageCounts=$ownerStages;
        warning='New version can persist post-send phase labels. Old turns and in-process 10-second fast-poll counters are not reconstructible from old disk files.'
      }
    } catch {
      $errors.Add('PowerShell fallback diagnostic failed: '+ $_.Exception.GetType().Name)
    }
    ExportSafeJson 'diagnostic-coverage.json' @{
      diagnosticSource='powershell-fallback';fullCausalCoverage=$false;
      perQuestion=@{
        videoAgentNotInvoked=@{decisionEvidence=(Test-Path (Join-Path $fallbackFolder 'life-decision-overview.json'));currentRuntimeGateProof=$false};
        originalMainCommentNotSent=@{decisionEvidence=(Test-Path (Join-Path $fallbackFolder 'life-decision-overview.json'));coherentSqliteProof=$false};
        naturalConversation=@{legacyStateEvidence=(Test-Path (Join-Path $fallbackFolder 'dm-expression-overview.json'));postSendStageAndLiveFastPollProof=$false}
      };missingOrUnobservable=@('sqlite-online-backup-not-done','live-scheduler-not-captured','python-enhanced-timelines-not-available');
      note='Raw logs and PowerShell summaries exported. NOT enough to guarantee complete root-cause debugging; re-export with a verified Python and live status if available.'
    }
    # An unavailable interpreter must never make a partial ZIP look complete.
    $diagnosticsFolder = Join-Path $generated '_diagnostics'
    New-Item -ItemType Directory -Path $diagnosticsFolder -Force | Out-Null
    $health = @{ diagnosticCompleted=$false; pythonVerified=[bool]$pythonExe;
      pythonProbeAttempts=$probeAttempts; pythonProbeMissingCandidates=$probeMissing; pythonProbeFailedCandidates=$probeFailed;
      fallbackSummariesGenerated=(Test-Path -LiteralPath (Join-Path $fallbackFolder 'life-decision-overview.json'));
      reason='interpreter-unavailable-or-helper-failed';
      snapshotsUsable=$false; note='The primary historical logs are still collected; enhanced evidence is INCOMPLETE.' }
    [IO.File]::WriteAllText((Join-Path $diagnosticsFolder 'export-launch-health.json'),
      ($health | ConvertTo-Json -Depth 3), ([Text.UTF8Encoding]::new($false)))
  }
  try {
    $coverageFile = Join-Path $generated '_diagnostics\diagnostic-coverage.json'
    if (Test-Path -LiteralPath $coverageFile -PathType Leaf) {
      $coverageDoc = Get-Content -LiteralPath $coverageFile -Encoding UTF8 -Raw | ConvertFrom-Json
      $coverageComplete = ($coverageDoc.fullCausalCoverage -eq $true)
      if (-not $coverageComplete) {
        $warnings.Add('Diagnostic coverage is partial. Read _diagnostics/diagnostic-coverage.json for exactly missing evidence.')
      }
    } else { $warnings.Add('Diagnostic coverage manifest missing: causal debugging completeness cannot be verified.') }
  } catch { $warnings.Add('Unable to read diagnostic-coverage.json; treat this export as partial.') }
  $zip = [System.IO.Compression.ZipFile]::Open($dest, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $files = Get-ChildItem -LiteralPath $root -Recurse -Force -File -ErrorAction SilentlyContinue -ErrorVariable +scanErrors
    foreach ($file in $files) {
      $rel = $file.FullName.Substring($root.Length + 1)
      $isAccount = $rel -match '^accounts\\'
      # Live SQLite files, WAL and SHM are NEVER copied directly. A coherent
      # Python sqlite3 backup is added below under the original archive path.
      if ($file.Name -match '(?i)\.(sqlite3?|db)(-wal|-shm|-journal)?$') { continue }
      if (-not $isAccount -and $rel -match '(^|\\)(\.venv[^\\]*|uv-cache|uv-python|node_modules|\.git|\.hf-cache|embedding-runtime|backup-before-reinstall[^\\]*|projects)(\\|$)') { continue }
      if (-not $isAccount -and $rel -match '(?i)(credential|cookie|token|secret|password|config)') { continue }
      $include = $isAccount -or $file.Name -match '(?i)\.log(\.\d+)?$|\.jsonl$' -or
        $rel -match '^(life-decision-traces|model-invocations|model-usage|mention-diagnostics|meme-diagnostics|read-action-executions|outbound-action-executions|life-agent-events|activity|out|reports)(\\|$)'
      if (-not $include) { continue }
      try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $rel.Replace('\','/'), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $count++
      } catch { $errors.Add($rel + ': ' + $_.Exception.GetType().Name) }
    }
    foreach ($e in $scanErrors) { $errors.Add('Scan: ' + $e.ToString()) }
    # Add all generated summaries. For valid online SQLite snapshots, restore
    # the ORIGINAL archive name so existing analysis scripts continue to work.
    $extra = Get-ChildItem -LiteralPath $generated -Recurse -Force -File -ErrorAction Stop
    foreach ($file in $extra) {
      $rel = $file.FullName.Substring($generated.Length + 1).Replace('\','/')
      if ($rel.StartsWith('sqlite-snapshots/')) { $rel = $rel.Substring('sqlite-snapshots/'.Length) }
      try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $count++
      } catch { $errors.Add('Generated snapshot: ' + $_.Exception.GetType().Name) }
    }
    $entry = $zip.CreateEntry('_export_readme.txt')
    $writer = New-Object System.IO.StreamWriter($entry.Open(), [System.Text.Encoding]::UTF8)
    try {
      $writer.WriteLine('Bili-duty evidence export (updated): original logs, Life traces, receipts, and bounded diagnostic summaries in _diagnostics/.')
      $writer.WriteLine('NEW: life-video-launch-state.json reads root autonomous-planner.json, state.json and whitelisted config fields; the original full config is NOT copied.')
      $writer.WriteLine('DIAG COVERAGE: see _diagnostics/diagnostic-coverage.json; missing data means incomplete investigation, even when archive export succeeded.')
      $writer.WriteLine('PYTHON DIAGNOSTICS: video-agent-decision-timeline.json, life-comment-decision-timeline.json, natural-chat-diagnostics.json, polling-and-model-budget.json, and coherent SQLite snapshots.')
      $writer.WriteLine('POWER SHELL FALLBACK: life-decision-overview.json and dm-expression-overview.json. The fallback does NOT cover all three debugging chains completely.')
      $writer.WriteLine('SQLite: when Python works, online sqlite3 backup; otherwise NO SQLite snapshot and PowerShell-only fallback summaries. Check export-launch-health.json.')
      $writer.WriteLine('In-process fast polling cannot be reconstructed from old disk files; optional --status-url http://127.0.0.1:PORT/api/bili-duty/status saves ONLY whitelisted live fields.')
      $writer.WriteLine('Post-send progressive bubble stages are available only for newer runs that persist them; older runs cannot be reconstructed.')
      $writer.WriteLine('WARNING: THIS ZIP IS NOT SANITIZED. Existing account runtime files, logs and receipts may contain credentials, private messages and secrets. Do not publish.')
      $writer.WriteLine('Files are captured while the service may be running; separate non-SQLite files can be at different times.')
      $writer.WriteLine('Helper executed: ' + $usedPython + '; diagnostic completed: ' + $diagCompleted)
      $writer.WriteLine('Files included: ' + $count)
      $writer.WriteLine('Export status: ' + $(if ($errors.Count -gt 0) {'FAILED'} elseif ($coverageComplete) {'FULL_EVIDENCE'} else {'PARTIAL_DIAGNOSTICS'}))
      $writer.WriteLine('File read/write or scan failures: ' + $errors.Count)
      foreach ($e in $errors) { $writer.WriteLine('ERROR: ' + $e) }
      $writer.WriteLine('Diagnostic warnings: ' + $warnings.Count)
      foreach ($w in $warnings) { $writer.WriteLine('WARNING: ' + $w) }
    } finally { $writer.Dispose() }
  } finally { $zip.Dispose() }
  Write-Host "Archive: $dest"
  Write-Host "Files: $count ; failed: $($errors.Count) ; warnings: $($warnings.Count)"
  if ($coverageComplete) { Write-Host 'Diagnostics: EVIDENCE COVERAGE COMPLETE (review all sources for diagnosis).' }
  elseif ($diagCompleted) { Write-Warning 'Diagnostics: PARTIAL COVERAGE. Python summaries and available online SQLite backups saved; see diagnostic-coverage.json for missing evidence.' }
  else { Write-Warning 'Diagnostics: PARTIAL (PowerShell summaries only; NO coherent SQLite snapshot). The three debugging chains are NOT fully covered.' }
  if (-not $diagCompleted -and $env:BILI_EXPORT_STRICT -eq '1') { Write-Warning 'Strict mode: required diagnostics incomplete.' }
  Write-Host 'WARNING: Archive is not sanitized and may contain private account information. Check before sharing.'
  if ($errors.Count -gt 0) { Write-Warning 'File export failed. See _export_readme.txt for errors.'; exit 1 }
  if ($count -eq 0) { Write-Error 'No matching files found.'; exit 1 }
  # Optional diagnostics being unavailable must not make a successfully written
  # primary log archive report an error code. PARTIAL remains explicit in ZIP.
  if ($env:BILI_EXPORT_STRICT -eq '1' -and -not $coverageComplete) {exit 3}
  exit 0
} finally {
  # Windows sqlite3 must close ALL handles before deleting temporary files.
  try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop } catch { Write-Warning 'Temporary export folder cleanup failed; remove it after closing Python.' }
}
