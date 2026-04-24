const audioFiles = {
  wizz: "./msn-assets/sounds/nudge.wav",
  message: "./msn-assets/sounds/type.wav",
  newEmail: "./msn-assets/sounds/newemail.wav",
  online: "./msn-assets/sounds/online.wav",
  phone: "./msn-assets/sounds/phone.wav",
  ring: "./msn-assets/sounds/ring.wav",
  type: "./msn-assets/sounds/newalert.wav",
  done: "./msn-assets/sounds/vimdone.wav"
};

export const soundCatalog = [
  ["message", "Nouveau message", audioFiles.message],
  ["wizz", "Wizz / Nudge", audioFiles.wizz],
  ["newEmail", "Nouvel e-mail", audioFiles.newEmail],
  ["online", "Contact en ligne", audioFiles.online],
  ["ring", "Sonnerie", audioFiles.ring],
  ["phone", "Telephone", audioFiles.phone],
  ["type", "Alerte", audioFiles.type],
  ["done", "Invite terminee", audioFiles.done]
];

function playAudio(src, fallback) {
  const audio = new Audio(src);
  audio.currentTime = 0;
  audio.play().catch(() => fallback?.());
}

export function playNewMessage() {
  playAudio(audioFiles.message);
}

function playSyntheticWizz() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.72);
  master.connect(ctx.destination);

  [[0, 620], [0.1, 880], [0.2, 540], [0.3, 980], [0.46, 720]].forEach(([offset, hz]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(hz, ctx.currentTime + offset);
    osc.frequency.exponentialRampToValueAtTime(hz * 1.28, ctx.currentTime + offset + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.13, ctx.currentTime + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.14);
    osc.connect(gain);
    gain.connect(master);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + 0.16);
  });

  window.setTimeout(() => ctx.close(), 900);
}

export function playWizz() {
  playAudio(audioFiles.wizz, playSyntheticWizz);
}

export function playSoundKey(soundKey) {
  playAudio(audioFiles[soundKey] ?? audioFiles.message);
}

export function playWink(wink) {
  playSoundKey(wink?.sound ?? "wizz");
}
