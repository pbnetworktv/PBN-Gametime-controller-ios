import AVFoundation
import Capacitor
import Foundation

@objc(PBNControllerAudioPlugin)
public class PBNControllerAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    public let identifier = "PBNControllerAudioPlugin"
    public let jsName = "PBNControllerAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var synthesizer = AVSpeechSynthesizer()
    private var speechCall: CAPPluginCall?
    private var utterance: AVSpeechUtterance?
    private var speechDeadline: DispatchWorkItem?
    private var players: [String: AVAudioPlayer] = [:]
    private var playerCalls: [String: CAPPluginCall] = [:]
    private var playerDeadlines: [String: DispatchWorkItem] = [:]
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        configureSynthesizer()
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            guard let kind = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber,
                  kind.uintValue == AVAudioSession.InterruptionType.began.rawValue else { return }
            self?.cancelSpeech(code: "INTERRUPTED", message: "Speech was interrupted by the system.")
            self?.cancelPlayers(code: "INTERRUPTED", message: "Audio was interrupted by the system.")
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.cancelSpeech(code: "INTERRUPTED", message: "The audio service restarted.")
            self.cancelPlayers(code: "INTERRUPTED", message: "The audio service restarted.")
            self.synthesizer = AVSpeechSynthesizer()
            self.configureSynthesizer()
        })
    }

    deinit {
        speechDeadline?.cancel()
        for deadline in playerDeadlines.values { deadline.cancel() }
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    private func configureSynthesizer() {
        // One shared playback session preserves the selected speaker/Bluetooth/PA route.
        synthesizer.usesApplicationAudioSession = true
        synthesizer.delegate = self
    }

    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        // Field announcements are core audio and must remain audible in Silent mode.
        // Do not overrideOutputAudioPort: respect the operator's selected output.
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setActive(true)
    }

    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                try self.activateSession()
                call.resolve()
            } catch {
                call.reject("Could not activate controller audio.", "AUDIO_SESSION_ERROR", error)
            }
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                call.reject("Speech text is required.", "INVALID_ARGUMENT")
                return
            }
            let rate = call.getDouble("rate") ?? 0.86
            let volume = call.getDouble("volume") ?? 1
            guard rate.isFinite, rate > 0, volume.isFinite, (0...1).contains(volume) else {
                call.reject("Speech rate or volume is invalid.", "INVALID_ARGUMENT")
                return
            }
            do {
                try self.activateSession()
            } catch {
                call.reject("Could not activate controller speech.", "AUDIO_SESSION_ERROR", error)
                return
            }
            self.cancelSpeech(code: "CANCELLED", message: "Speech was replaced.")
            let next = AVSpeechUtterance(string: text)
            next.voice = AVSpeechSynthesisVoice(language: "en-US")
            next.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(rate)))
            next.volume = Float(volume)
            self.utterance = next
            self.speechCall = call
            // Native speech has no error delegate. Reject a stalled utterance instead
            // of leaving the JavaScript announcement queue waiting forever.
            let deadline = DispatchWorkItem { [weak self, weak next] in
                guard let self = self, let next = next, self.utterance === next else { return }
                self.cancelSpeech(code: "PLAYBACK_TIMEOUT", message: "Controller speech did not finish.")
            }
            self.speechDeadline = deadline
            DispatchQueue.main.asyncAfter(deadline: .now() + max(20, Double(text.count) * 0.2 / max(0.25, rate) + 10), execute: deadline)
            self.synthesizer.speak(next)
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let asset = call.getString("asset"),
                  asset.range(of: "^audio/[A-Za-z0-9][A-Za-z0-9._-]*\\.(mp3|m4a|aac|wav|caf)$", options: .regularExpression) != nil else {
                call.reject("Choose a bundled audio file.", "INVALID_ARGUMENT")
                return
            }
            let volume = call.getDouble("volume") ?? 1
            let channel = call.getString("channel") ?? "cue"
            guard volume.isFinite, (0...1).contains(volume), ["voice", "cue"].contains(channel) else {
                call.reject("Audio volume or channel is invalid.", "INVALID_ARGUMENT")
                return
            }
            guard let root = self.bridge?.config.appLocation else {
                call.reject("The controller audio bundle is unavailable.", "ASSET_NOT_FOUND")
                return
            }
            let url = root.appendingPathComponent(asset)
            guard FileManager.default.fileExists(atPath: url.path) else {
                call.reject("The bundled audio file is missing: \(asset)", "ASSET_NOT_FOUND")
                return
            }
            do {
                try self.activateSession()
                let next = try AVAudioPlayer(contentsOf: url)
                next.delegate = self
                next.volume = Float(volume)
                self.cancelPlayer(channel: channel, code: "CANCELLED", message: "Audio was replaced.")
                self.players[channel] = next
                self.playerCalls[channel] = call
                guard next.prepareToPlay(), next.play() else {
                    self.cancelPlayer(channel: channel, code: "PLAYBACK_ERROR", message: "The controller audio file could not start.")
                    return
                }
                let deadline = DispatchWorkItem { [weak self, weak next] in
                    guard let self = self, let next = next, self.players[channel] === next else { return }
                    self.cancelPlayer(channel: channel, code: "PLAYBACK_TIMEOUT", message: "The controller audio file did not finish.")
                }
                self.playerDeadlines[channel] = deadline
                DispatchQueue.main.asyncAfter(deadline: .now() + max(10, next.duration + 5), execute: deadline)
            } catch {
                call.reject("Could not play controller audio.", "PLAYBACK_ERROR", error)
            }
        }
    }

    @objc func stopSpeech(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.cancelSpeech(code: "CANCELLED", message: "Speech was stopped.")
            self.cancelPlayer(channel: "voice", code: "CANCELLED", message: "Voice audio was stopped.")
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.cancelSpeech(code: "CANCELLED", message: "Speech was stopped.")
            self.cancelPlayers(code: "CANCELLED", message: "Audio was stopped.")
            call.resolve()
        }
    }

    private func cancelSpeech(code: String, message: String) {
        let call = speechCall
        speechCall = nil
        utterance = nil
        speechDeadline?.cancel()
        speechDeadline = nil
        synthesizer.stopSpeaking(at: .immediate)
        call?.reject(message, code)
    }

    private func cancelPlayers(code: String, message: String) {
        for channel in ["voice", "cue"] { cancelPlayer(channel: channel, code: code, message: message) }
    }

    private func cancelPlayer(channel: String, code: String, message: String) {
        let call = playerCalls.removeValue(forKey: channel)
        let previous = players.removeValue(forKey: channel)
        playerDeadlines.removeValue(forKey: channel)?.cancel()
        previous?.delegate = nil
        previous?.stop()
        call?.reject(message, code)
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish finished: AVSpeechUtterance) {
        guard utterance === finished else { return }
        let call = speechCall
        speechCall = nil
        utterance = nil
        speechDeadline?.cancel()
        speechDeadline = nil
        call?.resolve()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel cancelled: AVSpeechUtterance) {
        guard utterance === cancelled else { return }
        cancelSpeech(code: "CANCELLED", message: "Speech was cancelled.")
    }

    public func audioPlayerDidFinishPlaying(_ finished: AVAudioPlayer, successfully flag: Bool) {
        guard let channel = players.first(where: { $0.value === finished })?.key else { return }
        let call = playerCalls.removeValue(forKey: channel)
        players.removeValue(forKey: channel)
        playerDeadlines.removeValue(forKey: channel)?.cancel()
        if flag { call?.resolve() }
        else { call?.reject("The controller audio file did not finish.", "PLAYBACK_ERROR") }
    }

    public func audioPlayerDecodeErrorDidOccur(_ failed: AVAudioPlayer, error: Error?) {
        guard let channel = players.first(where: { $0.value === failed })?.key else { return }
        let call = playerCalls.removeValue(forKey: channel)
        players.removeValue(forKey: channel)
        playerDeadlines.removeValue(forKey: channel)?.cancel()
        call?.reject("The controller audio file could not be decoded.", "PLAYBACK_ERROR", error)
    }
}
