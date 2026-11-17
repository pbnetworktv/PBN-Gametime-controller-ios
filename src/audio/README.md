# Controller announcements

`voice-base.mp3`, `voice-point-approved.mp3`, `voice-point-reversed.mp3`, and
`voice-game-stopped.mp3` are the user's original supplied PlayHT recordings,
recovered from `labeled-playht-tracks.zip`. Their bytes are unchanged.
The approval recording is the archive's `call-point-approved-01.mp3`.

No recording of "No points" or "Game started" was present in the original
supplied pack. These announcements, plus variable break durations, use native
iOS speech in the app and browser speech on the hosted Controller.

Voice and countdown/horn playback use separate channels. A countdown beep
must not cut off a point announcement. An operator action cancels obsolete
announcements and horn callbacks.
