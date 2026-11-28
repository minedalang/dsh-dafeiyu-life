// Existing dev.90 fixed catalogue; shared by the isolated trial and offline storage.
const asset=(file,bytes,sha256)=>Object.freeze({file,bytes,sha256})
const model=(id,name,revision,weights,mmproj)=>Object.freeze({id,name,revision,repo:`unsloth/${name.replace(' ','-')}-GGUF`,weights,mmproj})
export const LLAMA_VISION_MODELS=Object.freeze([
  model('qwen3.5-2b','Qwen3.5 2B','31ea6ac42dacbee2db8a2540a323377b3f652c75',
    asset('Qwen3.5-2B-Q4_K_M.gguf',1280835808,'cbb39d5102a6e6ef9675912b1c21d02335f4374c6bc267faa6cb96d7987d4a7b'),
    asset('mmproj-F16.gguf',668227264,'7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7')),
  model('qwen3.5-4b','Qwen3.5 4B','e87f176479d0855a907a41277aca2f8ee7a09523',
    asset('Qwen3.5-4B-Q4_K_M.gguf',2740937888,'00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'),
    asset('mmproj-F16.gguf',672423616,'cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864')),
])
export const getLlamaVisionModel=id=>LLAMA_VISION_MODELS.find(x=>x.id===id)||null
export const llamaVisionAssetUrl=(model,asset)=>`https://huggingface.co/${model.repo}/resolve/${model.revision}/${asset.file}`
