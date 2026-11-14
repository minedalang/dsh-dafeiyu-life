/**
 * S0/S1 read-only acceptance evidence: bounded, anonymised, conservative.
 * Never a release switch, proof of watching, platform sending, GGUF inference,
 * cross-account isolation or multi-day growth. In particular, never copy
 * arbitrary fields from status/receipt objects into an exported report.
 */
import {classifyVideoCommentRound,videoCommentGateCode} from './video-comment-readiness.mjs'
const number=n=>Number.isSafeInteger(n)&&n>=0?Math.min(n,1_000_000):0
const safeEnum=(value,allowed,fallback='unknown')=>allowed.includes(value)?value:fallback
const FIELDS=['S0-windows-desktop','S0-bilibili-write-readback','S0-two-account-isolation',
 'S0-cold-backup-restore','S0-episode-continuity','S0-72h-stability',
 'S1-cross-day-growth','S1-python-gguf','S1-first-install-permission','S1-release-gate-truth']
export function releaseAcceptanceEvidence({config={},planner={},lifeEpisodeHealth=null,
 transition=null,embedding=null,bridgeReady=null,hostPlatform='unknown',now=Date.now()}={}){
 const rounds=Array.isArray(planner?.lifeEvents?.recentVideoRounds)?planner.lifeEvents.recentVideoRounds:[]
 const latest=rounds[0]
 const gate=videoCommentGateCode(config,{bridgeReady:bridgeReady===true})
 const recentComment=latest?classifyVideoCommentRound({gate:latest.commentGate||'unknown',
  pickedCount:latest.pickedCount,review:latest.commentDiagnostics,
  exitCode:latest.state==='completed'?0:latest.state==='failed'?1:null}):null
 const phase=safeEnum(transition?.phase8,['not-accepted','accepted'],'not-accepted')
 const ep=lifeEpisodeHealth&&typeof lifeEpisodeHealth==='object'?lifeEpisodeHealth:{}
 const latestStatus=safeEnum(latest?.state,['started','completed','failed','interrupted','unverified-interruption'],'not-observed')
 const consent={
  lifeMode:safeEnum(config?.lifeAgentMode,['off','active','shadow'],'off'),
  masterEnabled:config?.masterEnabled===true,
  autoComment:config?.autoComment===true,
  commentPerRound:number(config?.commentPerRound),
  commentDailyLimit:number(config?.commentDailyLimit),
  configuredGate:gate,
  elevatedDailyQuota:number(config?.commentDailyLimit)>100,
  // This is ONLY the current configuration, not evidence of original consent.
  permissionAcceptedOnThisInstallation:'not-proven'
 }
 const metric={active:number(ep.active),firstStepOnly:number(ep.firstStepOnly),
  staleFirstStep:number(ep.staleFirstStep),firstStepWithoutEligibleSource:number(ep.firstStepWithoutEligibleSource),
  eligibleToResume:number(ep.eligibleToResume),paused:number(ep.paused),
  pausedCooling:number(ep.pausedCooling),pausedWithoutEligibleSource:number(ep.pausedWithoutEligibleSource),
  pausedDueWithSource:number(ep.pausedDueWithSource),needsReview:number(ep.needsReview)}
 const checks=FIELDS.map(id=>({id,state:'requires-real-acceptance'}))
 const social=transition?.status||{}
 const unsafe=number(social.unknownSendResults)>0||number(social.needsReview)>0
 return {schemaVersion:1,readOnly:true,releaseReady:false,releaseCandidate:false,
  at:Number.isSafeInteger(now)&&now>=0?now:0,
  environment:safeEnum(hostPlatform,['win32','linux','darwin']),
  phase8:phase,
  checks,
  episode:metric,
  comment:{currentConfig:consent,roundsObserved:Math.min(20,rounds.length),latestRoundState:latestStatus,
   latestRoundPicked:latestStatus==='completed'&&Number.isSafeInteger(latest?.pickedCount)?number(latest.pickedCount):null,
   latestRoundDiagnosis:recentComment?.code||'not-observed',
   latestReviewCount:recentComment?.reviewed||0,latestProposals:recentComment?.proposed||0,
   latestApproved:recentComment?.approved||0,latestVerified:recentComment?.verified||0},
  outbound:{unknownCount:number(social.unknownSendResults),needsReview:number(social.needsReview),
   risk:unsafe?'freeze-and-review':'no-unknown-in-inspected-ledgers',
   currentAccountReady:social.accountReady===true,
   lifeSocialOwnerMigrationComplete:social.oldSocialOwner===false},
  embedding:{enabled:embedding?.enabled===true,supported:embedding?.supported===true,
   runtimeReported:embedding?.runtime?.installed===true,
   modelReported:embedding?.model?.installed===true,
   indexReady:embedding?.index?.ready===true,
   inferenceOnThisHost:'not-proven'},
  note:'只读匿名快照。没有 UID/BV/私信正文、凭据、事件 ID。不能证明平台发送、跨日成长、72 小时或 Windows 实机验收。请和平台原始只读回执及人工签核对照。'}
}
