import os
import requests
import time
import argparse
import re
import tempfile
import base64
import threading
import queue
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from gtts import gTTS
from constants import *

AVAILABLE_MODELS = {}

app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')
app.config['SECRET_KEY'] = FLASK_SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins="*")

audio_queue = queue.Queue()
processing_thread = None
is_processing = False

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
            "model": DEFAULT_MODEL,
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
    global AVAILABLE_MODELS
    try:
        response = requests.get(OLLAMA_TAGS_URL)
        if response.status_code != 200:
            return False, "Ollama n'est pas accessible"
        
        models = response.json().get("models", [])
        AVAILABLE_MODELS = {}
        for model in models:
            model_name = model.get("name")
            if ':' in model_name:
                AVAILABLE_MODELS[model_name] = model_name
            else:
                model_tag = model.get("tag")
                full_model_name = f"{model_name}:{model_tag}" if model_tag != "latest" else model_name
                AVAILABLE_MODELS[full_model_name] = full_model_name
        
        if DEFAULT_MODEL not in AVAILABLE_MODELS:
            return False, f"Le modèle {DEFAULT_MODEL} n'est pas téléchargé. Exécutez: ollama pull {DEFAULT_MODEL}"
        
        return True, "OK"
    except Exception as e:
        return False, f"Erreur lors de la vérification d'Ollama: {e}"

def process_audio_queue():
    global is_processing
    assistant = global_assistant
    
    while is_processing:
        try:
            audio_data = audio_queue.get(timeout=1)
            if audio_data:
                texte = assistant.analyser_audio(audio_data)
                
                if texte:
                    socketio.emit('transcript', {'text': texte})
                    
                    mots_arret = STOP_WORDS["fr"] if assistant.tts_lang == "fr" else STOP_WORDS["en"]
                    is_exit_phrase = any(mot in texte.lower() for mot in mots_arret)
                    
                    if is_exit_phrase:
                        response = RESPONSE_MESSAGES[assistant.tts_lang]["goodbye"]
                        audio_base64, _ = assistant.parler(response)
                        socketio.emit('response', {
                            'text': response,
                            'audio': audio_base64,
                            'lastUserMessage': texte
                        })
                    else:
                        response = assistant.obtenir_reponse_ollama(texte)
                        audio_base64, _ = assistant.parler(response)
                        socketio.emit('response', {
                            'text': response,
                            'audio': audio_base64,
                            'lastUserMessage': texte
                        })
                else:
                    error_msg = ERROR_MESSAGES[assistant.tts_lang]["not_understood"]
                    socketio.emit('error', {'message': error_msg})
            
            audio_queue.task_done()
        except queue.Empty:
            pass
        except Exception as e:
            print(f"Error in processing thread: {e}")
            error_prefix = "Erreur" if assistant.tts_lang == "fr" else "Error"
            socketio.emit('error', {'message': f'{error_prefix}: {str(e)}'})

@app.route('/models')
def get_models():
    return jsonify({"models": AVAILABLE_MODELS})

@app.route('/service-worker.js')
def serve_service_worker():
    return app.send_static_file('js/service-worker.js')

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('status', {'message': 'Connecté au serveur'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('start_listening')
def handle_start_listening():
    global processing_thread, is_processing
    
    if not is_processing:
        is_processing = True
        processing_thread = threading.Thread(target=process_audio_queue)
        processing_thread.daemon = True
        processing_thread.start()
    
    emit('listening_started')

@socketio.on('stop_listening')
def handle_stop_listening():
    global is_processing
    is_processing = False
    emit('listening_stopped')

@socketio.on('audio_data')
def handle_audio_data(data):
    audio_queue.put(data['audio'])

@socketio.on('change_model')
def handle_model_change(data):
    global DEFAULT_MODEL
    model = data.get('model')
    if model in AVAILABLE_MODELS:
        DEFAULT_MODEL = model
        print(f"Modèle changé pour {DEFAULT_MODEL}")
        emit('status', {'message': f'Modèle changé pour {DEFAULT_MODEL}'})
    else:
        emit('error', {'message': f'Modèle inconnu: {model}'})

@socketio.on('change_tts_lang')
def handle_tts_lang_change(data):
    assistant = global_assistant
    lang = data.get('lang')
    
    if lang in ['fr', 'en']:
        assistant.tts_lang = lang
        
        status_message = RESPONSE_MESSAGES[lang]["language_changed"]
        print(f"Langue changée pour {lang}")
        emit('status', {'message': status_message})
    else:
        error_message = ERROR_MESSAGES[assistant.tts_lang]["language_not_supported"]
        emit('error', {'message': f'{error_message}: {lang}'})

@socketio.on('text_input')
def handle_text_input(data):
    assistant = global_assistant
    texte = data['text']
    
    mots_arret = STOP_WORDS["fr"] if assistant.tts_lang == "fr" else STOP_WORDS["en"]
    is_exit_phrase = any(mot in texte.lower() for mot in mots_arret)
    
    if is_exit_phrase:
        response = RESPONSE_MESSAGES[assistant.tts_lang]["goodbye"]
        audio_base64, _ = assistant.parler(response)
        emit('response', {
            'text': response,
            'audio': audio_base64,
            'lastUserMessage': texte
        })
    else:
        response = assistant.obtenir_reponse_ollama(texte)
        audio_base64, _ = assistant.parler(response)
        emit('response', {
            'text': response,
            'audio': audio_base64,
            'lastUserMessage': texte
        })

if __name__ == '__main__':
    global_assistant = WebAssistant()
    ollama_ok, message = verifier_ollama()
    if not ollama_ok:
        print(f"❌ {message}")
    else:
        print(f"✅ Ollama est prêt avec le modèle {DEFAULT_MODEL}")
        
        parser = argparse.ArgumentParser(description='Voice Assistant Web App')
        parser.add_argument('--ssl', action='store_true', help='Enable HTTPS with self-signed certificate')
        args = parser.parse_args()
        
        if args.ssl:
            cert_path = 'cert.pem'
            key_path = 'key.pem'
            
            if not (os.path.exists(cert_path) and os.path.exists(key_path)):
                print("🔐 Generating self-signed SSL certificate...")
                os.system(f'openssl req -x509 -newkey rsa:4096 -nodes -out {cert_path} -keyout {key_path} -days 365 -subj "/CN=localhost"')
            
            print("🔒 Starting server with HTTPS enabled")
            socketio.run(app, host='0.0.0.0', port=5000, debug=True, 
                        ssl_context=(cert_path, key_path),
                        allow_unsafe_werkzeug=True)
        else:
            print("⚠️ Starting server without HTTPS. Microphone access may be blocked in browsers.")
            print("💡 Tip: Run with --ssl flag to enable HTTPS with a self-signed certificate.")
            socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)