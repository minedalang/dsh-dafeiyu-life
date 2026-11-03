/**
 * Claims that cannot be made merely because our account selected/read a public BV.
 * In particular, video-selection evidence is NOT a publishing receipt, and title
 * metadata is not an audio playback receipt. Conservative, high-confidence guard;
 * it complements the model prompt, it does not prove every sentence true.
 */
export function unsupportedVideoAuthorship(text=''){
  const s=String(text).slice(0,1200).replace(/\s+/g,'')
  const mine=/(?:我|咱|鱼鱼|大肥鱼)(?:自己|亲手|亲自|最近|之前|以前|刚刚|刚才|曾经|其实|已经|也|当时|当年|那时候)?/
  const verb=/(?:做|制作|拍|剪辑|剪|录制|录|创作|投稿|上传|发布)(?:的|了|过|完|出)?/
  // Actions with a clear first-person grammatical subject: no intervening
  // "别人拍的" matches. "我发给你的视频" is not a self-publishing claim.
  const authored=new RegExp(mine.source+verb.source+'(?:.{0,25}(?:视频|作品|那期|这期|一期|日记|翻唱|MV|动画|Vlog))','i')
  return authored.test(s)&&!/(?:我发给你|我发(?:给|来)的链接)/.test(s)||
    /(?:我(?:的|自己(?:的)?|亲手(?:做的)?)|咱们的|鱼鱼的)(?:原创|发布的|投稿的|制作的|拍的)?(?:视频|作品|那期|这期|投稿).{0,18}(?:入选|被推荐|上推荐|播放量|上热门)/i.test(s)||
    /(?:我(?:的)?投稿|我上传的|我发布的|我自己(?:写|唱|制作|剪辑|创作)的).{0,25}(?:作品|歌曲|歌|视频|那期|这期|翻唱|MV)/i.test(s)
}
export function unsupportedVideoExperience(text=''){
  const s=String(text).slice(0,1200)
  return unsupportedVideoAuthorship(s)||
    /(?:我|鱼鱼)(?:已经|刚刚|真的|认真|自己|之前|昨晚|最近|亲自)?.{0,4}(?:听完了|听过|听了|看完了|完整看过).{0,20}(?:歌|曲|翻唱|视频)/.test(s)
}
