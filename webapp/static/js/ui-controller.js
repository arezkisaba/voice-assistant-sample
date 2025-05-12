class UIController {
    constructor() {
        this.elements = {
            conversation: null,
            textInput: null,
            sendTextBtn: null,
            startRecordingBtn: null,
            recordingStatus: null,
            recordingIndicator: null,
            recordingText: null,
            cancelSpeechBtn: null,
            statusMessage: null,
            audioPlayer: null,
            assistantLoadingIndicator: null,
            userLoadingIndicator: null,
            ttsLangSelector: null,
            audioLevelMeter: null
        };
        
        this.isStreamingResponse = false;
        this.currentStreamingMessageDiv = null;
        this.currentStreamingContentDiv = null;
        this.streamedText = '';
    }

    initElements() {
        this.elements.conversation = document.getElementById('conversation');
        this.elements.textInput = document.getElementById('text-input');
        this.elements.sendTextBtn = document.getElementById('send-text');
        this.elements.startRecordingBtn = document.getElementById('start-recording');
        this.elements.recordingStatus = document.getElementById('recording-status');
        this.elements.recordingIndicator = this.elements.recordingStatus.querySelector('.recording-indicator');
        this.elements.recordingText = this.elements.recordingStatus.querySelector('span');
        this.elements.cancelSpeechBtn = document.getElementById('cancel-speech');
        this.elements.statusMessage = document.getElementById('status-message');
        this.elements.audioPlayer = document.getElementById('audio-player');
        this.elements.assistantLoadingIndicator = document.getElementById('assistant-loading-indicator');
        this.elements.userLoadingIndicator = document.getElementById('user-loading-indicator');
        this.elements.ttsLangSelector = document.getElementById('tts-lang-selector');
        
        if (!document.getElementById('audio-level-meter')) {
            const meterContainer = document.createElement('div');
            meterContainer.id = 'audio-level-container';
            meterContainer.className = 'audio-level-container';
            const meter = document.createElement('div');
            meter.id = 'audio-level-meter';
            meter.className = 'audio-level-meter';
            meterContainer.appendChild(meter);
            this.elements.recordingStatus.appendChild(meterContainer);
        }
        
        this.elements.audioLevelMeter = document.getElementById('audio-level-meter');
    }

    updateRecordingUI(isRecording) {
        if (isRecording) {
            this.elements.startRecordingBtn.classList.add('recording');
            this.elements.startRecordingBtn.innerHTML = '<span class="icon">⏹</span> Arrêter';
            this.elements.recordingIndicator.classList.add('active');
            this.elements.recordingText.textContent = 'Enregistrement...';
        } else {
            this.elements.startRecordingBtn.classList.remove('recording');
            this.elements.startRecordingBtn.innerHTML = '<span class="icon">🎤</span> Parler';
            this.elements.recordingIndicator.classList.remove('active');
            this.elements.recordingText.textContent = 'Inactive';
        }
    }

    setRecordingStatusText(text) {
        if (this.elements.recordingText) {
            this.elements.recordingText.textContent = text;
        }
    }

    showAssistantLoading() {
        const conversation = document.getElementById('conversation');
        conversation.insertAdjacentElement('afterend', this.elements.assistantLoadingIndicator);
        this.elements.assistantLoadingIndicator.classList.add('active');
        this.scrollToBottom();
    }

    hideAssistantLoading() {
        this.elements.assistantLoadingIndicator.classList.remove('active');
    }

    showUserLoading() {
        this.elements.userLoadingIndicator.classList.add('active');
        this.scrollToBottom();
    }

    hideUserLoading() {
        this.elements.userLoadingIndicator.classList.remove('active');
    }

    addMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const hasMarkdown = /(\*\*|__|##|```|\[.*\]\(.*\)|^\s*[-*+]\s|\|[-|]+\||^\s*>\s)/.test(text);
        
        if (hasMarkdown && sender === 'assistant') {
            contentDiv.innerHTML = marked.parse(text);
            contentDiv.classList.add('markdown-content');
            
            if (text.includes('```')) {
                this.applyCodeHighlighting(contentDiv);
            }
        } else {
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            contentDiv.appendChild(paragraph);
        }
        
        messageDiv.appendChild(contentDiv);
        this.elements.conversation.appendChild(messageDiv);
        
        this.scrollToBottom();
    }
    
    applyCodeHighlighting(contentElement) {
        const codeBlocks = contentElement.querySelectorAll('pre code');
        codeBlocks.forEach(block => {
            block.classList.add('hljs');
        });
    }

    scrollToBottom() {
        requestAnimationFrame(() => {
            const scrollContainer = document.querySelector('.conversation-container');
            scrollContainer.scrollTo({
                top: scrollContainer.scrollHeight,
                behavior: 'smooth'
            });
        });
    }

    setStatus(message, isError = false) {
        this.elements.statusMessage.textContent = message;
        this.elements.statusMessage.className = isError ? 'error' : '';
    }

    playAudioInUI(base64Audio) {
        const audioSrc = `data:audio/mp3;base64,${base64Audio}`;
        this.elements.audioPlayer.src = audioSrc;
        this.elements.audioPlayer.play();
        this.elements.recordingText.textContent = 'Assistant parle...';
        this.elements.recordingStatus.classList.add('speaking');
        
        if (this.elements.cancelSpeechBtn) {
            this.elements.cancelSpeechBtn.classList.remove('hidden');
        }
        
        this.elements.audioPlayer.onended = () => {
            this.stopSpeaking();
        };
    }
    
    stopSpeaking() {
        if (this.elements.cancelSpeechBtn) {
            this.elements.cancelSpeechBtn.classList.add('hidden');
        }
        
        this.elements.recordingStatus.classList.remove('speaking');
        this.elements.recordingText.textContent = 'Inactive';
    }

    clearInput() {
        this.elements.textInput.value = '';
    }

    disableTextInput(disable) {
        this.elements.sendTextBtn.disabled = disable;
        this.elements.textInput.disabled = disable;
    }
    
    updateAudioLevel(level) {
        if (!this.elements.audioLevelMeter) {
            return;
        }
        
        this.elements.audioLevelMeter.style.width = `${level}%`;
        this.elements.audioLevelMeter.classList.remove('low-level', 'mid-level', 'high-level');
        
        if (level < 30) {
            this.elements.audioLevelMeter.classList.add('low-level');
        } else if (level < 70) {
            this.elements.audioLevelMeter.classList.add('mid-level');
        } else {
            this.elements.audioLevelMeter.classList.add('high-level');
        }
    }

    startStreamingResponse(initialText) {
        this.isStreamingResponse = true;
        this.streamedText = initialText;
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const paragraph = document.createElement('p');
        paragraph.textContent = initialText;
        contentDiv.appendChild(paragraph);
        messageDiv.appendChild(contentDiv);
        this.elements.conversation.appendChild(messageDiv);
        this.currentStreamingMessageDiv = messageDiv;
        this.currentStreamingContentDiv = contentDiv;
        this.scrollToBottom();
    }
    
    appendToStreamingResponse(textChunk) {
        if (!this.isStreamingResponse || !this.currentStreamingContentDiv) {
            this.startStreamingResponse(textChunk);
            return;
        }
        
        // Vérifier si le nouveau chunk commence par un élément de liste numérotée ou contient du formatage
        const isNumberedListItem = textChunk.trim().match(/^\d+\.\s/);
        const containsFormatting = textChunk.includes('*') || textChunk.includes('_') || textChunk.includes('`');
        
        // Ajouter le nouveau morceau de texte en préservant les retours à la ligne et le formatage
        if (textChunk.trim().startsWith('\n') || textChunk.trim().startsWith('\r\n')) {
            this.streamedText += textChunk;
        } else if (isNumberedListItem) {
            // Si c'est un élément de liste numérotée, s'assurer qu'il commence sur une nouvelle ligne
            if (!this.streamedText.endsWith('\n') && !this.streamedText.endsWith('\r\n') && this.streamedText.length > 0) {
                this.streamedText += '\n' + textChunk;
            } else {
                this.streamedText += textChunk;
            }
        } else {
            // Vérifier si le texte existant se termine par un retour à la ligne
            const endsWithNewline = this.streamedText.endsWith('\n') || this.streamedText.endsWith('\r\n');
            // Vérifier si textChunk contient du Markdown qui nécessite un retour à la ligne
            const isNewParagraph = textChunk.trim().match(/^(\#{1,6}|\*|\-|\+|\d+\.)\s/);
            
            // Si le chunk contient un formatage spécial, être prudent avec les espaces
            if (containsFormatting) {
                // Préserver les délimiteurs de formatage en évitant d'ajouter des espaces qui pourraient les casser
                const lastChar = this.streamedText.slice(-1);
                const firstChar = textChunk.charAt(0);
                
                // Éviter d'ajouter un espace si cela casserait le formatage
                // Par exemple, ne pas ajouter d'espace entre 'texte' et '**gras**'
                if (lastChar === '*' || lastChar === '_' || lastChar === '`' || 
                    firstChar === '*' || firstChar === '_' || firstChar === '`') {
                    this.streamedText += textChunk;
                } else if (endsWithNewline || isNewParagraph) {
                    this.streamedText += textChunk;
                } else {
                    this.streamedText += ' ' + textChunk;
                }
            } else if (endsWithNewline || isNewParagraph) {
                this.streamedText += textChunk;
            } else {
                this.streamedText += ' ' + textChunk;
            }
        }
        
        // Prétraiter le texte pour gérer correctement les listes et le formatage
        let processedText = this.streamedText;
        
        // Remplacer les motifs de liste numérotée pour s'assurer qu'ils sont sur des lignes séparées
        processedText = processedText.replace(/(\S)(\s*)(\d+\.\s)/g, '$1\n$3');
        
        // S'assurer que les balises de formatage sont correctement espacées
        // Éviter les espaces indésirables autour des balises de mise en forme
        processedText = processedText.replace(/\s+\*\*/g, ' **').replace(/\*\*\s+/g, '** ');
        processedText = processedText.replace(/\s+\*/g, ' *').replace(/\*\s+/g, '* ');
        processedText = processedText.replace(/\s+__/g, ' __').replace(/__\s+/g, '__ ');
        processedText = processedText.replace(/\s+_/g, ' _').replace(/_\s+/g, '_ ');
        processedText = processedText.replace(/\s+`/g, ' `').replace(/`\s+/g, '` ');
        
        // Vérifier si le texte contient du Markdown
        const hasMarkdown = /(\*\*|__|##|```|\[.*\]\(.*\)|^\s*[-*+]\s|\|[-|]+\||^\s*>\s|\d+\.\s|\*[^*]+\*|_[^_]+_)/.test(processedText);
        
        if (hasMarkdown) {
            // Utiliser Markdown pour le formatage avec les options pour préserver les retours à la ligne
            this.currentStreamingContentDiv.innerHTML = marked.parse(processedText, { 
                breaks: true,  // Convertir les retours à la ligne simples en <br>
                gfm: true      // Utiliser GitHub Flavored Markdown
            });
            this.currentStreamingContentDiv.classList.add('markdown-content');
            
            // Ajouter la coloration syntaxique pour les blocs de code
            if (processedText.includes('```')) {
                this.applyCodeHighlighting(this.currentStreamingContentDiv);
            }
        } else {
            // Texte simple
            const paragraph = this.currentStreamingContentDiv.querySelector('p');
            if (paragraph) {
                paragraph.textContent = processedText;
            } else {
                const newParagraph = document.createElement('p');
                newParagraph.textContent = processedText;
                this.currentStreamingContentDiv.appendChild(newParagraph);
            }
        }
        
        this.scrollToBottom();
    }
    
    completeStreamingResponse() {
        this.isStreamingResponse = false;
        this.currentStreamingMessageDiv = null;
        this.currentStreamingContentDiv = null;
        this.streamedText = '';
        this.scrollToBottom();
    }
}

const uiController = new UIController();
export default uiController;