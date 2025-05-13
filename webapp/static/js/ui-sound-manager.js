class UISoundManager {
    constructor() {
        this.sounds = {
            listening: new Audio('/static/audio/listening.mp3'),
            thinking: new Audio('/static/audio/thinking.mp3'),
            shutdown: new Audio('/static/audio/shutdown.mp3')
        };
        
        this.sounds.listening.volume = 0.5;
        this.sounds.thinking.volume = 0.5;
        this.sounds.shutdown.volume = 0.5;
        this.sounds.listening.loop = false;
        this.sounds.thinking.loop = false;
        this.sounds.shutdown.loop = false;
    }
    
    async playListeningSound() {
        this.stopAllSounds();
        this.sounds.listening.currentTime = 0;
        try {
            await this.sounds.listening.play();
            return new Promise((resolve, reject) => {
                this.sounds.listening.onended = () => {
                    resolve();
                };
                
                this.sounds.listening.onerror = (error) => {
                    console.error('Error during listening sound playback:', error);
                    reject(error);
                };
            });
        } catch (error) {
            console.error('Erreur lors de la lecture du son d\'écoute:', error);
            throw error;
        }
    }
    
    async playThinkingSound() {
        this.stopAllSounds();
        this.sounds.thinking.currentTime = 0;
        try {
            await this.sounds.thinking.play();
            return new Promise((resolve, reject) => {
                this.sounds.thinking.onended = () => {
                    resolve();
                };
                
                this.sounds.thinking.onerror = (error) => {
                    console.error('Error during thinking sound playback:', error);
                    reject(error);
                };
            });
        } catch (error) {
            console.error('Erreur lors de la lecture du son de réflexion:', error);
            throw error;
        }
    }
    
    async playShutdownSound() {
        this.stopAllSounds();
        this.sounds.shutdown.currentTime = 0;
        try {
            await this.sounds.shutdown.play();
            return new Promise((resolve, reject) => {
                this.sounds.shutdown.onended = () => {
                    resolve();
                };
                
                this.sounds.shutdown.onerror = (error) => {
                    console.error('Error during shutdown sound playback:', error);
                    reject(error);
                };
            });
        } catch (error) {
            console.error('Erreur lors de la lecture du son de shutdown:', error);
            throw error;
        }
    }
    
    stopAllSounds() {
        this.sounds.listening.pause();
        this.sounds.listening.currentTime = 0;
        this.sounds.thinking.pause();
        this.sounds.thinking.currentTime = 0;
        this.sounds.shutdown.pause();
        this.sounds.shutdown.currentTime = 0;
    }
}

const uiSoundManager = new UISoundManager();
export default uiSoundManager;