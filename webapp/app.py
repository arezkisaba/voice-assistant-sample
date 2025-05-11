#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import requests
import time
import argparse
import re
import tempfile
import numpy as np
from io import BytesIO
import base64
import sys
from contextlib import contextmanager
import threading
import queue

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

from gtts import gTTS

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gemma3:12b"
SYSTEM_PROMPT = """Tu es un assistant vocal français intelligent et serviable. 
Réponds de manière claire et concise, idéalement en 2-3 phrases. 
Privilégie la simplicité et la clarté dans tes réponses."""

app = Flask(__name__, 
            static_folder='static',
            template_folder='templates')
app.config['SECRET_KEY'] = 'voiceassistantsecret'
socketio = SocketIO(app, cors_allowed_origins="*")

audio_queue = queue.Queue()
processing_thread = None
is_processing = False

# Créer une instance partagée de WebAssistant
global_assistant = None

@contextmanager
def suppress_stderr():
    stderr = sys.stderr
    devnull = open(os.devnull, 'w')
    sys.stderr = devnull
    try:
        yield
    finally:
        sys.stderr = stderr
        devnull.close()

class WebAssistant:
    def __init__(self):
        self.temp_dir = tempfile.gettempdir()
        self.conversation_history = []

    def parler(self, texte):
        texte = self._nettoyer_texte(texte)
        
        try:
            tts = gTTS(text=texte, lang='fr', slow=False)
            
            timestamp = int(time.time())
            temp_file = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}.mp3")
            temp_file_fast = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}_fast.mp3")
            tts.save(temp_file)
            
            # Accélérer l'audio avec ffmpeg (similaire à main.py)
            speed_factor = 1.3
            cmd = f"ffmpeg -y -i {temp_file} -filter:a \"atempo={speed_factor}\" -vn {temp_file_fast}"
            os.system(cmd)
            
            # Utiliser le fichier accéléré s'il existe, sinon utiliser le fichier original
            audio_file = temp_file_fast if os.path.exists(temp_file_fast) else temp_file
            
            with open(audio_file, 'rb') as f:
                audio_data = f.read()
                audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            # Nettoyer les fichiers temporaires
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
        
        payload = {
            "model": MODEL_NAME,
            "prompt": prompt,
            "system": SYSTEM_PROMPT,
            "stream": False,
            "options": {
                "temperature": 0.7,
                "top_p": 0.9
            }
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
                return "Désolé, j'ai rencontré une erreur de communication avec le modèle."
        except Exception as e:
            print(f"❌ Exception lors de l'appel à Ollama: {e}")
            return "Désolé, je ne peux pas accéder au modèle pour le moment."

    def analyser_audio(self, audio_data):
        try:
            # Decode base64 audio data
            audio_bytes = base64.b64decode(audio_data.split(',')[1])
            
            # Create temp files for the audio
            # Use unique identifiers based on timestamp to avoid conflicts
            timestamp = int(time.time() * 1000)
            temp_source = os.path.join(self.temp_dir, f"temp_audio_source_{timestamp}")
            temp_wav = os.path.join(self.temp_dir, f"temp_audio_{timestamp}.wav")
            
            # Save the raw audio data to a temporary file
            with open(temp_source, 'wb') as f:
                f.write(audio_bytes)
            
            # Convert to WAV format using ffmpeg
            conversion_command = f"ffmpeg -y -i {temp_source} -acodec pcm_s16le -ar 16000 -ac 1 {temp_wav}"
            conversion_process = os.system(conversion_command)
            
            if conversion_process != 0:
                print(f"❌ Error converting audio: ffmpeg returned {conversion_process}")
                return None
            
            # Use Google's speech recognition
            import speech_recognition as sr
            recognizer = sr.Recognizer()
            
            with sr.AudioFile(temp_wav) as source:
                audio = recognizer.record(source)
                
            # Try to recognize
            try:
                texte = recognizer.recognize_google(audio, language="fr-FR")
                return texte
            except sr.UnknownValueError:
                print("Speech not recognized")
                return None
            except sr.RequestError as e:
                print(f"Google Speech API error: {e}")
                return None
            finally:
                # Clean up
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
        response = requests.get("http://localhost:11434/api/tags")
        if response.status_code != 200:
            return False, "Ollama n'est pas accessible"
        
        models = response.json().get("models", [])
        model_names = [model.get("name") for model in models]
        
        if MODEL_NAME not in model_names:
            return False, f"Le modèle {MODEL_NAME} n'est pas téléchargé. Exécutez: ollama pull {MODEL_NAME}"
        
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
                # Analyze audio
                texte = assistant.analyser_audio(audio_data)
                
                if texte:
                    socketio.emit('transcript', {'text': texte})
                    
                    # Check for exit phrases
                    mots_arret = ["au revoir", "arrête", "stop", "termine", "bye", "goodbye", "exit", "quit", "ciao"]
                    if any(mot in texte.lower() for mot in mots_arret):
                        response = "Au revoir! À bientôt."
                        audio_base64, _ = assistant.parler(response)
                        socketio.emit('response', {
                            'text': response,
                            'audio': audio_base64
                        })
                    else:
                        # Get response from Ollama
                        response = assistant.obtenir_reponse_ollama(texte)
                        audio_base64, _ = assistant.parler(response)
                        socketio.emit('response', {
                            'text': response,
                            'audio': audio_base64
                        })
                else:
                    socketio.emit('error', {'message': 'Je n\'ai pas compris ce que vous avez dit'})
            
            audio_queue.task_done()
        except queue.Empty:
            pass
        except Exception as e:
            print(f"Error in processing thread: {e}")
            socketio.emit('error', {'message': f'Erreur: {str(e)}'})

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

@socketio.on('text_input')
def handle_text_input(data):
    assistant = global_assistant
    texte = data['text']
    
    # Check for exit phrases
    mots_arret = ["au revoir", "arrête", "stop", "termine", "bye", "goodbye", "exit", "quit", "ciao"]
    if any(mot in texte.lower() for mot in mots_arret):
        response = "Au revoir! À bientôt."
        audio_base64, _ = assistant.parler(response)
        emit('response', {
            'text': response,
            'audio': audio_base64
        })
    else:
        # Get response from Ollama
        response = assistant.obtenir_reponse_ollama(texte)
        audio_base64, _ = assistant.parler(response)
        emit('response', {
            'text': response,
            'audio': audio_base64
        })

if __name__ == '__main__':
    global_assistant = WebAssistant()
    ollama_ok, message = verifier_ollama()
    if not ollama_ok:
        print(f"❌ {message}")
    else:
        print(f"✅ Ollama est prêt avec le modèle {MODEL_NAME}")
        
        # Parse command line arguments
        parser = argparse.ArgumentParser(description='Voice Assistant Web App')
        parser.add_argument('--ssl', action='store_true', help='Enable HTTPS with self-signed certificate')
        args = parser.parse_args()
        
        if args.ssl:
            # Generate self-signed certificate if it doesn't exist
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