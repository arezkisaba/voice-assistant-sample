const config = {
    defaultTtsLang: "fr",
    currentModel: "",
    currentTtsLang: "fr",
    isRecording: false,
    isPlayingAudio: false,
    continuousListening: true,
    stopWords: ["au revoir", "bye"], // Mots pour terminer la conversation
    shutdownWords: ["stop", "arrête", "interrompt", "tais-toi", "silence"] // Mots pour interrompre la réponse du LLM
};

export default config;