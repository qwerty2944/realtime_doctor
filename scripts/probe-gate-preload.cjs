// S2 프로브 전용 preload.
//
// 일부러 앱의 preload 를 쓰지 않는다. 검증하려는 것이 "렌더러 UI 를 거치지 않고
// IPC 채널을 직접 때렸을 때도 막히는가"이기 때문에, 채널명을 그대로 보내는
// 최소 브릿지를 쓴다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('probe', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
});
