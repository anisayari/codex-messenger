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

function playAudio(src) {
  const audio = new Audio(src);
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function playNewMessage() {
  playAudio(audioFiles.message);
}

export function playWizz() {
  playAudio(audioFiles.wizz);
}

export function playSoundKey(soundKey) {
  playAudio(audioFiles[soundKey] ?? audioFiles.message);
}

export function playWink() {
  // The original SWF contains its own audio, played by MsnFlashPlayer.
}
