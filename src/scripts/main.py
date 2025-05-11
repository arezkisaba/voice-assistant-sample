import os
import json
import requests
import time
import argparse
import threading
import re
import tempfile
from io import BytesIO
from playsound import playsound
from ctypes import *
from contextlib import contextmanager
import sys

import speech_recognition as sr
from gtts import gTTS

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "gemma3:12b"
SYSTEM_PROMPT = """Tu es un assistant vocal français intelligent et serviable. 
Réponds de manière claire et concise, idéalement en 2-3 phrases. 
Privilégie la simplicité et la clarté dans tes réponses."""

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

class AssistantVocal:
    def __init__(self):
        with suppress_stderr():
            self.recognizer = sr.Recognizer()
        
        self.temp_dir = tempfile.gettempdir()
        
        self.listening = False
        self.conversation_history = []
        self.language = "fr-FR"
    
    def ecouter(self):
        with suppress_stderr():
            with sr.Microphone() as source:
                self.recognizer.adjust_for_ambient_noise(source, duration=1.5)
                
                self.recognizer.energy_threshold = 1500
                self.recognizer.dynamic_energy_threshold = True
                self.recognizer.pause_threshold = 1.2
                self.recognizer.non_speaking_duration = 1.0
                
                print("🎤 J'écoute...", end="", flush=True)
                
                try:
                    audio = self.recognizer.listen(
                        source, 
                        timeout=None,
                        phrase_time_limit=12
                    )
                    print(" terminé")
                except sr.WaitTimeoutError:
                    print(" temps d'attente dépassé")
                    return None
        
        try:
            if self._est_silence(audio):
                print("🔇 Silence détecté - aucune entrée vocale")
                return None
            
            texte = None
            
            try:
                texte = self.recognizer.recognize_google(audio, language="fr-FR")
            except:
                pass
                
            if not texte:
                try:
                    options = {"language": "fr-FR", "show_all": True}
                    results = self.recognizer.recognize_google(audio, **options)
                    if isinstance(results, dict) and 'alternative' in results and results['alternative']:
                        texte = results['alternative'][0]['transcript']
                except:
                    pass
            
            if not texte:
                try:
                    texte = self.recognizer.recognize_google(audio)
                except:
                    pass
            
            if texte and len(texte.strip()) < 2:
                print("🔇 Détection trop courte ignorée")
                return None
                
            if texte:
                print(f"🗣️ Vous avez dit: {texte}")
                return texte
            else:
                print("❓ Je n'ai pas compris ce que vous avez dit")
                return None
                
        except sr.UnknownValueError:
            print("❓ Je n'ai pas compris ce que vous avez dit")
            return None
        except sr.RequestError as e:
            print(f"❌ Erreur avec le service de reconnaissance: {e}")
            return None
            
    def _est_silence(self, audio_data):
        try:
            import numpy as np
            
            audio_array = np.frombuffer(audio_data.get_raw_data(), dtype=np.int16)
            
            rms = np.sqrt(np.mean(np.square(audio_array.astype(np.float32))))
            
            silence_threshold = 200
            
            if rms < silence_threshold:
                return True
                
            silence_percentage = np.sum(np.abs(audio_array) < 100) / len(audio_array)
            if silence_percentage > 0.9:
                return True
                
            return False
        except Exception as e:
            print(f"⚠️ Erreur lors de la vérification du silence: {e}")
            return False
    
    def parler(self, texte):
        texte = self._nettoyer_texte(texte)
        print(f"🔊 Assistant: {texte}")
        
        try:
            tts = gTTS(text=texte, lang='fr', slow=False)
            
            temp_file = os.path.join(self.temp_dir, f"assistant_vocal_{int(time.time())}.mp3")
            tts.save(temp_file)
            
            if self._check_ffplay_installed():
                speed_factor = 1.3
                cmd = f"ffplay -nodisp -autoexit -loglevel quiet -af atempo={speed_factor} {temp_file}"
                os.system(cmd)
            else:
                playsound(temp_file)
            
            try:
                os.remove(temp_file)
            except:
                pass
                
        except Exception as e:
            print(f"❌ Erreur lors de la synthèse vocale: {e}")
    
    def _check_ffplay_installed(self):
        try:
            result = os.system("ffplay -version > /dev/null 2>&1")
            return result == 0
        except:
            return False
    
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
    
    def demarrer_conversation(self):
        self.listening = True
        self.parler("Bonjour! Je suis votre assistant vocal français. Comment puis-je vous aider?")
        
        while self.listening:
            question = self.ecouter()
            if question:
                mots_arret = ["au revoir", "arrête", "stop", "termine", "bye", "goodbye", "exit", "quit", "ciao"]
                if any(mot in question.lower() for mot in mots_arret):
                    self.parler("Au revoir! À bientôt.")
                    self.listening = False
                    break
                    
                reponse = self.obtenir_reponse_ollama(question)
                self.parler(reponse)
            time.sleep(0.5)

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

def main():
    parser = argparse.ArgumentParser(description="Assistant Vocal Français avec Ollama et Gemma 3:12B")
    parser.add_argument("--texte", action="store_true", help="Mode texte uniquement (sans voix)")
    args = parser.parse_args()
    
    print("🤖 Assistant Vocal Français avec Ollama et Gemma 3:12B")
    print("------------------------------------------------")
    
    ollama_ok, message = verifier_ollama()
    if not ollama_ok:
        print(f"❌ {message}")
        return
    
    print(f"✅ Ollama est prêt avec le modèle {MODEL_NAME}")
    
    if args.texte:
        print("\n📝 Mode texte activé (tapez 'quitter' pour sortir)")
        assistant = AssistantVocal()
        while True:
            question = input("\n➡️ Vous: ")
            if question.lower() in ["quitter", "exit", "q"]:
                break
            reponse = assistant.obtenir_reponse_ollama(question)
            print(f"🤖 Assistant: {reponse}")
    else:
        try:
            assistant = AssistantVocal()
            print("\n🎤 Mode vocal activé (dites 'au revoir' pour terminer)")
            assistant.demarrer_conversation()
        except KeyboardInterrupt:
            print("\n👋 Assistant vocal arrêté.")
    
if __name__ == "__main__":
    main()