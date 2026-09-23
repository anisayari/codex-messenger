(() => {
  const approved = [
  "packages/winks/msgslang_WINK_1121_9/water_balloon.swf",
  "packages/winks/msgslang_WINK_1122_9/bouncy_ball.swf",
  "packages/winks/msgslang_WINK_1123_9/lightbulb.swf",
  "packages/winks/msgslang_WINK_1124_9/crying.swf",
  "packages/winks/msgslang_WINK_1125_9/ufo.swf",
  "packages/winks/msgslang_WINK_1126_9/frog.swf",
  "packages/winks/msgslang_WINK_1127_9/dancer.swf",
  "packages/winks/msgslang_WINK_1128_9/bow.swf",
  "packages/winks/msgslang_WINK_1129_9/heart.swf",
  "packages/winks/msgslang_WINK_1130_9/silly_face.swf",
  "packages/winks/msgslang_WINK_1131_9/dancing_pig.swf",
  "packages/winks/msgslang_WINK_1132_9/kiss.swf",
  "packages/winks/msgslang_WINK_1133_9/guitar_smash.swf",
  "packages/winks/msgslang_WINK_1134_9/knock.swf",
  "packages/winks/msgslang_WINK_1135_9/laughing_girl.swf",
  "packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1600_9/extracted/KoiPond.swf",
  "packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1601_9/extracted/Clocks.swf",
  "packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1602_9/extracted/mad_scientist.swf",
  "packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1603_9/extracted/Pixies.swf"
];
  const query = new URLSearchParams(location.search);
  const selected = query.get('movie');
  const token = query.get('token');
  const isFileFrame = location.protocol === 'file:';
  const send = (type, extra = {}) => parent.postMessage({ type, token, ...extra }, isFileFrame || location.origin === 'null' ? '*' : location.origin);
  if (!approved.includes(selected)) { send('msn-flash-error', { message: 'Cette animation ne fait pas partie des ressources MSN locales.' }); return; }
  const assetBase = location.protocol === 'file:'
    ? 'msn-asset://local/msn-assets/'
    : new URL('../', location.href).href;
  const movie = new URL('msn75/' + selected, assetBase).href;
  const runtimePath = new URL('ruffle/0.6.0/', assetBase).href;
  const connect = [movie, new URL('72a20ef1c0b8ceb37720.wasm', runtimePath).href, new URL('826bb0938097485a2c9d.wasm', runtimePath).href];
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = "default-src 'none'; script-src " + runtimePath + " 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src " + connect.join(' ') + "; img-src data:; media-src blob:; object-src 'none'; frame-src 'none'";
  document.head.append(policy);
  let player;
  let muted = query.get('muted') === '1';
  const setVolume = () => { if (player) player.ruffle().volume = muted ? 0 : 1; };
  const close = () => { try { player?.ruffle().suspend(); } catch {} player?.remove(); };
  addEventListener('message', (event) => {
    const validParentOrigin = isFileFrame ? event.origin === 'null' : event.origin === location.origin;
    if (event.source !== parent || !validParentOrigin || event.data?.token !== token) return;
    if (event.data.type === 'msn-flash-mute') { muted = Boolean(event.data.muted); setVolume(); }
    if (event.data.type === 'msn-flash-close') close();
  });
  addEventListener('pagehide', close);
  window.RufflePlayer = { config: { publicPath: runtimePath, polyfills: false } };
  const script = document.createElement('script');
  script.src = runtimePath + 'ruffle.js';
  script.onerror = () => send('msn-flash-error', { message: 'Le lecteur local des animations MSN n’a pas pu être chargé.' });
  script.onload = async () => {
    try {
      player = window.RufflePlayer.newest().createPlayer();
      document.getElementById('movie').append(player);
      player.addEventListener('loadedmetadata', () => { setVolume(); send('msn-flash-ready', { metadata: player.ruffle().metadata }); }, { once: true });
      await player.ruffle().load({ url: movie, allowScriptAccess: false, allowNetworking: 'none', openUrlMode: 'deny', autoplay: 'on', unmuteOverlay: 'visible', splashScreen: false, contextMenu: 'off', showSwfDownload: false, wmode: 'transparent', letterbox: 'on', logLevel: 'error' });
      setVolume();
    } catch (cause) { close(); send('msn-flash-error', { message: cause.message || 'L’animation MSN n’a pas pu être lue.' }); }
  };
  document.head.append(script);
})();
