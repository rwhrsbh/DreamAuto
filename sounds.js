const playAlertLetter = () => {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const mainOscillator = audioContext.createOscillator();
        const mainGain = audioContext.createGain();
        mainOscillator.type = 'sine';
        mainOscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        mainOscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.15);
        mainGain.gain.setValueAtTime(0, audioContext.currentTime);
        mainGain.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.01);
        mainGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.3);

        const sweepOscillator = audioContext.createOscillator();
        const sweepGain = audioContext.createGain();
        sweepOscillator.type = 'sine';
        sweepOscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        sweepOscillator.frequency.exponentialRampToValueAtTime(1500, audioContext.currentTime + 0.1);
        sweepGain.gain.setValueAtTime(0, audioContext.currentTime);
        sweepGain.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.02);
        sweepGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.15);

        const sparkleOscillator = audioContext.createOscillator();
        const sparkleGain = audioContext.createGain();
        sparkleOscillator.type = 'sine';
        sparkleOscillator.frequency.setValueAtTime(2200, audioContext.currentTime);
        sparkleOscillator.frequency.linearRampToValueAtTime(3000, audioContext.currentTime + 0.05);
        sparkleGain.gain.setValueAtTime(0, audioContext.currentTime);
        sparkleGain.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.01);
        sparkleGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.08);

        const compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
        compressor.knee.setValueAtTime(30, audioContext.currentTime);
        compressor.ratio.setValueAtTime(12, audioContext.currentTime);
        compressor.attack.setValueAtTime(0.002, audioContext.currentTime);
        compressor.release.setValueAtTime(0.15, audioContext.currentTime);

        const distortion = audioContext.createWaveShaper();
        function makeDistortionCurve(amount) {
            const k = amount;
            const n_samples = 44100;
            const curve = new Float32Array(n_samples);
            for (let i = 0; i < n_samples; ++i) {
                const x = (i * 2) / n_samples - 1;
                curve[i] = (Math.PI + k) * x / (Math.PI + k * Math.abs(x));
            }
            return curve;
        }
        distortion.curve = makeDistortionCurve(2);
        distortion.oversample = '4x';

        const stereoPanner = audioContext.createStereoPanner();
        stereoPanner.pan.setValueAtTime(-0.3, audioContext.currentTime);
        stereoPanner.pan.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.15);

        mainOscillator.connect(mainGain);
        sweepOscillator.connect(sweepGain);
        sparkleOscillator.connect(sparkleGain);

        mainGain.connect(distortion);
        sweepGain.connect(distortion);
        sparkleGain.connect(distortion);

        distortion.connect(stereoPanner);
        stereoPanner.connect(compressor);
        compressor.connect(audioContext.destination);

        mainOscillator.start(audioContext.currentTime);
        sweepOscillator.start(audioContext.currentTime + 0.02);
        sparkleOscillator.start(audioContext.currentTime + 0.04);

        mainOscillator.stop(audioContext.currentTime + 0.3);
        sweepOscillator.stop(audioContext.currentTime + 0.15);
        sparkleOscillator.stop(audioContext.currentTime + 0.08);

        setTimeout(() => {
            audioContext.close();
        }, 600);

    } catch (err) {
        console.error('Ошибка воспроизведения звука уведомления:', err);
    }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "playAlertChat") {
        console.log("Получено сообщение playAlertChat в активной вкладке");
        playAlertChat();
    }
    return true;
});


const playAlertChat = () => {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const mainOscillator = audioContext.createOscillator();
        const mainGain = audioContext.createGain();
        mainOscillator.type = 'sine';
        mainOscillator.frequency.setValueAtTime(520, audioContext.currentTime);
        mainGain.gain.setValueAtTime(0, audioContext.currentTime);
        mainGain.gain.linearRampToValueAtTime(0.25, audioContext.currentTime + 0.05);
        mainGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.8);

        const harmonicOscillator = audioContext.createOscillator();
        const harmonicGain = audioContext.createGain();
        harmonicOscillator.type = 'triangle';
        harmonicOscillator.frequency.setValueAtTime(780, audioContext.currentTime);
        harmonicGain.gain.setValueAtTime(0, audioContext.currentTime);
        harmonicGain.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.05);
        harmonicGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.6);

        const accentOscillator = audioContext.createOscillator();
        const accentGain = audioContext.createGain();
        accentOscillator.type = 'sine';
        accentOscillator.frequency.setValueAtTime(1040, audioContext.currentTime);
        accentGain.gain.setValueAtTime(0, audioContext.currentTime);
        accentGain.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.02);
        accentGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.4);

        const filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, audioContext.currentTime);
        filter.Q.setValueAtTime(1, audioContext.currentTime);

        const convolver = audioContext.createConvolver();
        const reverbGain = audioContext.createGain();
        reverbGain.gain.setValueAtTime(0.2, audioContext.currentTime);

        const impulseLength = 0.5;
        const sampleRate = audioContext.sampleRate;
        const impulse = audioContext.createBuffer(2, sampleRate * impulseLength, sampleRate);
        for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < channelData.length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.1));
            }
        }
        convolver.buffer = impulse;

        mainOscillator.connect(mainGain);
        harmonicOscillator.connect(harmonicGain);
        accentOscillator.connect(accentGain);

        mainGain.connect(filter);
        harmonicGain.connect(filter);
        accentGain.connect(filter);

        filter.connect(convolver);
        filter.connect(audioContext.destination);
        convolver.connect(reverbGain);
        reverbGain.connect(audioContext.destination);

        mainOscillator.start(audioContext.currentTime);
        harmonicOscillator.start(audioContext.currentTime + 0.02);
        accentOscillator.start(audioContext.currentTime + 0.04);

        mainOscillator.stop(audioContext.currentTime + 0.8);
        harmonicOscillator.stop(audioContext.currentTime + 0.6);
        accentOscillator.stop(audioContext.currentTime + 0.4);

        setTimeout(() => {
            audioContext.close();
        }, 1500);

    } catch (err) {
        console.error('Ошибка воспроизведения звука уведомления:', err);
    }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "playAlertLetter") {
        console.log("Получено сообщение playAlertLetter в активной вкладке");
        playAlertLetter();
    }
    return true;
});