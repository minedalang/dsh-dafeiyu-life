/**
 * A deliberately tiny, fixed vocabulary of possible VISUAL MODEL mentions.
 * These are NOT independent scene facts, quotes or a replay of model prose.
 * The arbitrary model response (including embedded instructions) is never
 * written to the durable life event.
 */
const VOCAB=Object.freeze([
 ['人物',/(?:人物|真人|一个人|两个人|人类|男子|女子|男生|女生)/],
 ['动画角色',/(?:动画角色|动漫角色|卡通角色|虚拟角色)/],
 ['动物',/(?:动物|小猫|猫咪|狗狗|小狗|熊猫|兔子|鸟儿|宠物)/],
 ['耳机',/(?:耳机|耳塞|头戴式|入耳式)/],
 ['手机',/(?:手机|智能手机)/],
 ['电脑',/(?:电脑|笔记本电脑|计算机|显示器|屏幕)/],
 ['桌面',/(?:桌面|桌子|书桌|桌前)/],
 ['床边',/(?:床边|床上|床铺|床头)/],
 ['室内',/(?:室内|卧室|房间|客厅|办公室)/],
 ['街道',/(?:街道|马路|道路|行人)/],
 ['户外',/(?:户外|草地|树林|公园|山野)/],
 ['游戏画面',/(?:游戏画面|游戏角色|游戏界面|游戏场景)/],
 ['产品展示',/(?:产品展示|商品展示|产品介绍|商品介绍|开箱)/],
 ['评测比较',/(?:评测|测评|对比|比较|参数分析|横向比较)/],
 ['讲解',/(?:讲解|解说|科普|教程|演示)/],
 ['字幕文字',/(?:字幕|画面文字|标题卡|说明卡片)/],
 ['走动',/(?:走动|走路|行走|移动|走向)/],
 ['互动',/(?:互动|交谈|对话|玩耍)/],
 ['跳跃',/(?:跳跃|跳起|跳下|摔落|掉下|坠落)/],
 ['操作物品',/(?:拿起|放下|伸手|操作|摆弄|调整物品)/],
 ['镜头变化',/(?:镜头变化|场景切换|切镜|转场)/]
])
const VALID=new Set(VOCAB.map(row=>row[0]))
const UNSAFE=/(?:忽略.{0,12}指令|系统提示|system\s*prompt|developer\s*message|api.?key|token|cookie|密码|验证码|私信|联系方式|电话号码|微信号|http[s]?:\/\/)/i
export function deriveVideoSceneCues(description){
 const text=typeof description==='string'?description.slice(0,3600):''
 if(!text.trim()||UNSAFE.test(text))return []
 return VOCAB.filter(([,pattern])=>pattern.test(text)).map(([name])=>name).slice(0,5)
}
export function safeVideoSceneCues(value){
 if(!Array.isArray(value))return []
 return [...new Set(value.slice(0,10).filter(v=>typeof v==='string'&&VALID.has(v)))].slice(0,5)
}
