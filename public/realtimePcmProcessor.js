/* Runs on the browser audio thread. The microphone is never connected audibly to the speakers. */
class MessengerPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(2048);
    this.count = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] ?? 0;
      this.frame[this.count++] = sample / channels.length;
      if (this.count === this.frame.length) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(2048);
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor("codex-messenger-pcm", MessengerPcmProcessor);
