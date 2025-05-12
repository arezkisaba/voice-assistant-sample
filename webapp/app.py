import os
import requests
import time
import re
import tempfile
import base64
import queue
import markdown
import html
from flask import Flask
from flask_socketio import SocketIO
from gtts import gTTS
from constants import *
from routes import register_routes

AVAILABLE_MODELS = [{}]
MODEL_REF = [DEFAULT_MODEL]

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = FLASK_SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins="*")

audio_queue = queue.Queue()
is_processing_ref = [False]
processing_thread_ref = [None]

global_assistant = None

class WebAssistant:
    def __init__(self):
        self.temp_dir = tempfile.gettempdir()
        self.conversation_history = []
        self.tts_lang = DEFAULT_TTS_LANG
        self.speech_lang_map = SPEECH_LANG_MAP

    def parler(self, texte):
        # Réinitialiser le flag d'annulation avant de commencer
        CANCEL_SPEECH_SYNTHESIS[0] = False
        
        # Convertir le markdown en texte pour la synthèse vocale
        texte_brut = self._markdown_to_text(texte)
        texte_brut = self._nettoyer_texte(texte_brut)
        
        try:
            tts = gTTS(text=texte_brut, lang=self.tts_lang, slow=False)
            
            timestamp = int(time.time())
            temp_file = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}.mp3")
            temp_file_fast = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}_fast.mp3")
            tts.save(temp_file)
            
            # Vérifier si l'annulation a été demandée après la génération du fichier
            if CANCEL_SPEECH_SYNTHESIS[0]:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
                return None, RESPONSE_MESSAGES[self.tts_lang]["speech_cancelled"]
            
            cmd = f"ffmpeg -y -i {temp_file} -filter:a \"atempo={AUDIO_SPEED_FACTOR}\" -vn {temp_file_fast}"
            os.system(cmd)
            
            # Vérifier à nouveau si l'annulation a été demandée
            if CANCEL_SPEECH_SYNTHESIS[0]:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
                if os.path.exists(temp_file_fast):
                    os.remove(temp_file_fast)
                return None, RESPONSE_MESSAGES[self.tts_lang]["speech_cancelled"]
            
            audio_file = temp_file_fast if os.path.exists(temp_file_fast) else temp_file
            
            with open(audio_file, 'rb') as f:
                audio_data = f.read()
                audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
                if os.path.exists(temp_file_fast):
                    os.remove(temp_file_fast)
            except Exception as e:
                print(f"❌ Erreur lors du nettoyage des fichiers: {e}")
                
            return audio_base64, texte
                
        except Exception as e:
            print(f"❌ Erreur lors de la synthèse vocale: {e}")
            return None, texte
    
    def _markdown_to_text(self, markdown_text):
        """Convertit le markdown en texte brut pour la synthèse vocale."""
        if not markdown_text:
            return ""
            
        # Supprimer complètement les blocs de code
        text = re.sub(r'```[\s\S]*?```', '', markdown_text)
        
        # Supprimer les backticks simples (code inline)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        
        # Supprimer les balises HTML
        text = re.sub(r'<[^>]+>', '', text)
        
        # Convertir les liens [texte](url) en texte uniquement
        text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
        
        # Supprimer les symboles de titre (#)
        text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
        
        # Supprimer les symboles de liste (*, -, +)
        text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
        
        # Supprimer les listes numériques
        text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
        
        # Supprimer les symboles d'emphase (* et _) pour le gras et l'italique
        text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)  # Gras **texte**
        text = re.sub(r'__(.*?)__', r'\1', text)      # Gras __texte__
        text = re.sub(r'\*(.*?)\*', r'\1', text)      # Italique *texte*
        text = re.sub(r'_(.*?)_', r'\1', text)        # Italique _texte_
        
        # Supprimer les symboles de citation (>)
        text = re.sub(r'^\s*>\s+', '', text, flags=re.MULTILINE)
        
        # Supprimer les barres horizontales (---, ___, ***)
        text = re.sub(r'^\s*([-_*])\1{2,}\s*$', '', text, flags=re.MULTILINE)
        
        # Remplacer les tableaux par une indication simple
        if '|' in text and re.search(r'[-|]+', text):
            # Détection améliorée des tableaux
            lines = text.split('\n')
            in_table = False
            table_lines = []
            
            for i, line in enumerate(lines):
                if '|' in line:
                    if not in_table:
                        in_table = True
                    table_lines.append(i)
                elif in_table and not line.strip():
                    # Ligne vide après un tableau
                    in_table = False
            
            if table_lines:
                # Nombre de tableaux détectés
                table_count = 1
                prev_line = -2
                
                for line_num in table_lines:
                    if line_num > prev_line + 1:
                        table_count += 1
                    prev_line = line_num
                
                # Remplacer chaque tableau par une description simple
                text_lines = text.split('\n')
                for i in sorted(table_lines, reverse=True):
                    if i < len(text_lines):
                        text_lines.pop(i)
                        if i == table_lines[0]:
                            text_lines.insert(i, f"[Tableau]")
                
                text = '\n'.join(text_lines)
        
        # Supprimer les espaces et retours à la ligne superflus
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text.strip()
        
        return text
    
    def _nettoyer_texte(self, texte):
        texte = re.sub(r'(\d+)\.(\d+)', r'\1 virgule \2', texte)
        texte = re.sub(r'(\w+)\.(\w+)', r'\1 point \2', texte)
        return texte
    
    def obtenir_reponse_ollama(self, question):
        # Create a context that includes language information
        context_messages = []
        current_lang = self.tts_lang
        
        # Add a language indicator with each message in the history
        for i, msg in enumerate(self.conversation_history):
            speaker = 'Assistant' if i%2 else 'Utilisateur'
            context_messages.append(f"{speaker} [{current_lang}]: {msg}")
        
        # Add the current question with language indicator
        context = "\n".join(context_messages)
        prompt = f"{context}\nUtilisateur [{current_lang}]: {question}\nAssistant [{current_lang}]:"
        system_prompt = SYSTEM_PROMPTS.get(self.tts_lang, SYSTEM_PROMPTS["fr"])

        print(f"Envoi à Ollama: {prompt}")
        print(f"Envoi system à Ollama: {system_prompt}")
        
        payload = {
            "model": MODEL_REF[0],
            "prompt": prompt,
            "system": system_prompt,
            "stream": False,
            "options": OLLAMA_OPTIONS
        }
        
        try:
            response = requests.post(OLLAMA_URL, json=payload)
            if response.status_code == 200:
                response_text = response.json().get("response", "")
                if len(self.conversation_history) > 10:
                    self.conversation_history = self.conversation_history[-10:]
                self.conversation_history.append(question)
                self.conversation_history.append(response_text)
                return response_text
            else:
                print(f"❌ Erreur Ollama: {response.status_code}")
                return ERROR_MESSAGES[self.tts_lang]["model_communication"]
        except Exception as e:
            print(f"❌ Exception lors de l'appel à Ollama: {e}")
            return ERROR_MESSAGES[self.tts_lang]["model_access"]

    def analyser_audio(self, audio_data):
        try:
            audio_bytes = base64.b64decode(audio_data.split(',')[1])
            
            # Création d'un répertoire temporaire unique pour chaque session
            import uuid
            session_id = str(uuid.uuid4())
            session_dir = os.path.join(self.temp_dir, f"audio_session_{session_id}")
            os.makedirs(session_dir, exist_ok=True)
            
            timestamp = int(time.time() * 1000)
            temp_source = os.path.join(session_dir, f"temp_audio_source_{timestamp}")
            temp_wav = os.path.join(session_dir, f"temp_audio_{timestamp}.wav")
            
            with open(temp_source, 'wb') as f:
                f.write(audio_bytes)
            
            # Utiliser subprocess pour une meilleure gestion des erreurs
            import subprocess
            conversion_command = ["ffmpeg", "-y", "-i", temp_source, "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", temp_wav]
            
            try:
                process = subprocess.run(conversion_command, capture_output=True, text=True, check=False)
                if process.returncode != 0:
                    print(f"❌ Error converting audio: ffmpeg returned {process.returncode}")
                    print(f"STDERR: {process.stderr}")
                    return None
            except Exception as e:
                print(f"❌ Error executing ffmpeg: {e}")
                return None
            
            import speech_recognition as sr
            recognizer = sr.Recognizer()
            
            with sr.AudioFile(temp_wav) as source:
                audio = recognizer.record(source)
                
            speech_lang = self.speech_lang_map.get(self.tts_lang, "fr-FR")
            print(f"Reconnaissance vocale avec la langue: {speech_lang}")
                
            try:
                texte = recognizer.recognize_google(audio, language=speech_lang)
                return texte
            except sr.UnknownValueError:
                print("Speech not recognized")
                return None
            except sr.RequestError as e:
                print(f"Google Speech API error: {e}")
                return None
            finally:
                try:
                    # Nettoyage complet du répertoire de session
                    import shutil
                    shutil.rmtree(session_dir, ignore_errors=True)
                except Exception as cleanup_error:
                    print(f"Error during cleanup: {cleanup_error}")
                    pass
                
        except Exception as e:
            print(f"Error processing audio: {e}")
            return None

def verifier_ollama():
    try:
        response = requests.get(OLLAMA_TAGS_URL)
        if response.status_code != 200:
            return False, "Ollama n'est pas accessible"
        
        models = response.json().get("models", [])
        models_dict = {}
        for model in models:
            model_name = model.get("name")
            if ':' in model_name:
                models_dict[model_name] = model_name
            else:
                model_tag = model.get("tag")
                full_model_name = f"{model_name}:{model_tag}" if model_tag != "latest" else model_name
                models_dict[full_model_name] = full_model_name
        
        AVAILABLE_MODELS[0] = models_dict
        
        if MODEL_REF[0] not in AVAILABLE_MODELS[0]:
            return False, f"Le modèle {MODEL_REF[0]} n'est pas téléchargé. Exécutez: ollama pull {MODEL_REF[0]}"
        
        return True, "OK"
    except Exception as e:
        return False, f"Erreur lors de la vérification d'Ollama: {e}"

if __name__ == '__main__':
    global_assistant = WebAssistant()
    register_routes(
        app, 
        socketio, 
        global_assistant, 
        audio_queue, 
        is_processing_ref, 
        processing_thread_ref, 
        AVAILABLE_MODELS, 
        MODEL_REF
    )
    
    ollama_ok, message = verifier_ollama()
    if not ollama_ok:
        print(f"❌ {message}")
    else:
        print(f"✅ Ollama est prêt avec le modèle {MODEL_REF[0]}")
        
        cert_path = '/home/arezkisaba/git/voice-assistant-sample/webapp/certs/192.168.1.100+3.pem'
        key_path = '/home/arezkisaba/git/voice-assistant-sample/webapp/certs/192.168.1.100+3-key.pem'
        
        # if not (os.path.exists(cert_path) and os.path.exists(key_path)):
        #     print("🔐 Generating self-signed SSL certificate...")
        #     os.system(f'openssl req -x509 -newkey rsa:4096 -nodes -out {cert_path} -keyout {key_path} -days 365 -subj "/CN=localhost"')
        
        print("🔒 Starting server with HTTPS enabled")
        socketio.run(
            app,
            host='0.0.0.0',
            port=5000,
            debug=True, 
            ssl_context=(cert_path, key_path),
            allow_unsafe_werkzeug=True
        )