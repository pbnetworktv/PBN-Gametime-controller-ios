export interface PBNControllerAudioPlugin {
  /** Configure and activate the playback session; call again after returning to the app. */
  prepare(): Promise<void>;
  /** Replace speech only. Resolves when the utterance finishes, not when it is queued. */
  speak(options: { text: string; rate?: number; volume?: number }): Promise<void>;
  /** Replace only the selected file channel. Asset must be a bundled audio/<filename> path. */
  play(options: { asset: string; volume?: number; channel?: "voice" | "cue" }): Promise<void>;
  /** Cancel speech and the voice file channel, leaving countdown beeps/horns playing. */
  stopSpeech(): Promise<void>;
  /** Cancel speech and the current file cue. Pending calls reject with CANCELLED. */
  stop(): Promise<void>;
}

export declare const PBNControllerAudio: PBNControllerAudioPlugin;
