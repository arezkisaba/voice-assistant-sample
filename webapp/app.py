import os
import requests
import time
import re
import tempfile
import base64
import queue
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
        texte = self._nettoyer_texte(texte)
        
        try:
            tts = gTTS(text=texte, lang=self.tts_lang, slow=False)
            
            timestamp = int(time.time())
            temp_file = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}.mp3")
            temp_file_fast = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}_fast.mp3")
            tts.save(temp_file)
            
            cmd = f"ffmpeg -y -i {temp_file} -filter:a \"atempo={AUDIO_SPEED_FACTOR}\" -vn {temp_file_fast}"
            os.system(cmd)
            
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
    
    def _nettoyer_texte(self, texte):
        texte = re.sub(r'(\d+)\.(\d+)', r'\1 virgule \2', texte)
        texte = re.sub(r'(\w+)\.(\w+)', r'\1 point \2', texte)
        return texte
    
    def obtenir_reponse_ollama(self, question):
        context = "\n".join([f"{'Assistant' if i%2 else 'Utilisateur'}: {msg}" 
                            for i, msg in enumerate(self.conversation_history)])
        
        prompt = f"{context}\nUtilisateur: {question}\nAssistant:"
        
        system_prompt = SYSTEM_PROMPTS.get(self.tts_lang, SYSTEM_PROMPTS["fr"])
        
        payload = {
            "model": MODEL_REF[0],  # Utiliser la référence au modèle
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
            
            timestamp = int(time.time() * 1000)
            temp_source = os.path.join(self.temp_dir, f"temp_audio_source_{timestamp}")
            temp_wav = os.path.join(self.temp_dir, f"temp_audio_{timestamp}.wav")
            
            with open(temp_source, 'wb') as f:
                f.write(audio_bytes)
            
            conversion_command = f"ffmpeg -y -i {temp_source} -acodec pcm_s16le -ar 16000 -ac 1 {temp_wav}"
            conversion_process = os.system(conversion_command)
            
            if conversion_process != 0:
                print(f"❌ Error converting audio: ffmpeg returned {conversion_process}")
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
                    os.remove(temp_source)
                    os.remove(temp_wav)
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
        
        cert_path = 'cert.pem'
        key_path = 'key.pem'
        
        if not (os.path.exists(cert_path) and os.path.exists(key_path)):
            print("🔐 Generating self-signed SSL certificate...")
            os.system(f'openssl req -x509 -newkey rsa:4096 -nodes -out {cert_path} -keyout {key_path} -days 365 -subj "/CN=localhost"')
        
        print("🔒 Starting server with HTTPS enabled")
        socketio.run(
            app,
            host='0.0.0.0',
            port=5000,
            debug=True, 
            ssl_context=(cert_path, key_path),
            allow_unsafe_werkzeug=True
        )