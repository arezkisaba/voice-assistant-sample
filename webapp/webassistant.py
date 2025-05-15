import os
import requests
import time
import re
import tempfile
import base64
import json
import requests
import shutil
import speech_recognition as sr
import subprocess
import uuid
from gtts import gTTS
from constants import *

class WebAssistant:
    def __init__(self):
        self.temp_dir = tempfile.gettempdir()
        self.conversation_history = []
        self.tts_lang = DEFAULT_TTS_LANG
        self.speech_lang_map = SPEECH_LANG_MAP

    def get_ollama_response(self, user_prompt, socketio, audio_queue, model_ref):
        interrupt_words = INTERRUPT_WORDS[self.tts_lang]
        has_interrupt_prefix = any(word in user_prompt.lower() for word in interrupt_words)
        if has_interrupt_prefix:
            socketio.emit('interrupt', {'message': RESPONSE_MESSAGES[self.tts_lang]["response_cancelled"]})

        activation_words = ACTIVATION_WORDS[self.tts_lang]
        has_activation_prefix = any(word in user_prompt.lower() for word in activation_words)
        if not has_activation_prefix:
            return

        socketio.emit('transcript', {'text': user_prompt})
        user_prompt = user_prompt[len("ok assistant"):].strip() if user_prompt.lower().startswith("ok assistant") else user_prompt
        
        context_messages = []
        current_lang = self.tts_lang
        for i, msg in enumerate(self.conversation_history):
            speaker = 'Assistant' if i%2 else 'Utilisateur'
            context_messages.append(f"{speaker} [{current_lang}]: {msg}")
        
        context = "\n".join(context_messages)
        prompt = f"{context}\nUtilisateur [{current_lang}]: {user_prompt}\nAssistant [{current_lang}]:"
        system_prompt = SYSTEM_PROMPTS.get(self.tts_lang, SYSTEM_PROMPTS["fr"])
        
        payload = {
            "model": model_ref,
            "prompt": prompt,
            "system": system_prompt,
            "stream": True,
            "options": OLLAMA_OPTIONS
        }

        print(f"🔄 Envoi de la requête à Ollama: {payload}")
        
        try:
            response_stream = requests.post(OLLAMA_URL, json=payload, stream=True)
            
            if response_stream.status_code != 200:
                print(f"❌ Erreur Ollama: {response_stream.status_code}")
                error_msg = ERROR_MESSAGES[self.tts_lang]["model_communication"]
                socketio.emit('response', {'text': error_msg, 'isComplete': True})
                return
            
            full_response = ""
            buffer = ""
            current_blocks = []
            
            for line in response_stream.iter_lines():
                parallel_audio_instruction = self._get_parallel_audio_instruction(audio_queue)
                if (parallel_audio_instruction):
                    parallel_user_prompt = self.analyze_audio(parallel_audio_instruction)
                    if parallel_user_prompt:
                        has_interrupt_prefix = any(word in parallel_user_prompt.lower() for word in interrupt_words)
                        if has_interrupt_prefix:
                            socketio.emit('interrupt', {'message': RESPONSE_MESSAGES[self.tts_lang]["response_cancelled"]})
                            break
                if line:
                    try:
                        chunk_data = json.loads(line)
                        if 'response' in chunk_data:
                            chunk_text = chunk_data['response']
                            buffer += chunk_text
                            full_response += chunk_text
                            
                            if '\n' in buffer:
                                blocks = buffer.split('\n')
                                complete_blocks = blocks[:-1]
                                
                                if complete_blocks:
                                    blocks_text = '\n'.join(complete_blocks)
                                    current_blocks.extend(complete_blocks)
                                    audio_base64, _ = self._convert_text_to_speech(blocks_text)
                                    socketio.emit('response_chunk', {
                                        'text': blocks_text,
                                        'audio': audio_base64,
                                        'isComplete': False
                                    })
                                    
                                    buffer = blocks[-1]
                    except json.JSONDecodeError:
                        print(f"Erreur décodage JSON: {line}")
                        continue
                    
                    if 'done' in chunk_data and chunk_data['done']:
                        if buffer.strip():
                            last_audio_base64, _ = self._convert_text_to_speech(buffer)
                            socketio.emit('response_chunk', {
                                'text': buffer,
                                'audio': last_audio_base64,
                                'isComplete': False
                            })
                            current_blocks.append(buffer)
                        
                        socketio.emit('response_complete', {
                            'lastUserMessage': user_prompt,
                            'isComplete': True
                        })
                        
                        if len(self.conversation_history) > 10:
                            self.conversation_history = self.conversation_history[-10:]
                        self.conversation_history.append(user_prompt)
                        self.conversation_history.append(full_response)
                        break
            
            return full_response
            
        except Exception as e:
            print(f"❌ Exception lors du streaming depuis Ollama: {e}")
            error_msg = ERROR_MESSAGES[self.tts_lang]["model_access"]
            socketio.emit('response', {'text': error_msg, 'isComplete': True})
            return None

    def analyze_audio(self, audio_data):
        try:
            print(f"💾 Début d'analyse audio, taille de données: {len(audio_data) if audio_data else 'None'}")
            if not audio_data or len(audio_data) < 100:
                print("❌ Données audio invalides ou trop petites")
                return None

            audio_bytes = base64.b64decode(audio_data.split(',')[1])
            print(f"💾 Audio décodé avec succès, taille: {len(audio_bytes)} octets")
            
            session_id = str(uuid.uuid4())
            session_dir = os.path.join(self.temp_dir, f"audio_session_{session_id}")
            os.makedirs(session_dir, exist_ok=True)
            timestamp = int(time.time() * 1000)
            temp_source = os.path.join(session_dir, f"temp_audio_source_{timestamp}")
            temp_wav = os.path.join(session_dir, f"temp_audio_{timestamp}.wav")
            
            with open(temp_source, 'wb') as f:
                f.write(audio_bytes)
            print(f"💾 Fichier source écrit: {temp_source}")
            
            # Analyse des premiers octets pour diagnostic
            with open(temp_source, 'rb') as f:
                header = f.read(16)
                header_hex = ' '.join([f'{b:02x}' for b in header])
                print(f"🔍 En-tête fichier audio: {header_hex}")
            
            # Modify the conversion command to hide ffmpeg output
            conversion_command = ["ffmpeg", "-y", "-loglevel", "error", "-i", temp_source, "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", temp_wav]
            print(f"🔄 Commande de conversion: ffmpeg conversion (output hidden)")
            
            try:
                process = subprocess.run(conversion_command, capture_output=True, text=True, check=False)
                if process.returncode != 0:
                    print(f"❌ Error converting audio: ffmpeg returned {process.returncode}")
                    print(f"STDERR: {process.stderr}")
                    return None
                print(f"✅ Conversion réussie: {temp_wav}")
            except Exception as e:
                print(f"❌ Error executing ffmpeg: {e}")
                return None
            
            recognizer = sr.Recognizer()
            
            with sr.AudioFile(temp_wav) as source:
                print(f"🎤 Lecture du fichier WAV converti")
                audio = recognizer.record(source)
                print(f"✅ Audio chargé dans recognizer")
                
            speech_lang = self.speech_lang_map.get(self.tts_lang, "fr-FR")
            print(f"🗣️ Reconnaissance vocale avec la langue: {speech_lang}")
                
            try:
                print("🔍 Tentative de reconnaissance via Google...")
                texte = recognizer.recognize_google(audio, language=speech_lang)
                print(f"✅ Texte reconnu: {texte}")
                return texte
            except sr.UnknownValueError:
                print("❌ Speech not recognized - aucune parole détectée")
                return None
            except sr.RequestError as e:
                print(f"❌ Google Speech API error: {e}")
                return None
            finally:
                try:
                    # Conserver les fichiers temporaires en cas d'erreur pour le débogage
                    if os.path.exists(temp_source) and os.path.exists(temp_wav):
                        print(f"🧹 Nettoyage des fichiers temporaires dans: {session_dir}")
                        shutil.rmtree(session_dir, ignore_errors=True)
                    else:
                        print(f"⚠️ Conservation des fichiers de débogage dans: {session_dir}")
                except Exception as cleanup_error:
                    print(f"⚠️ Error during cleanup: {cleanup_error}")
                    pass
                
        except Exception as e:
            import traceback
            print(f"❌ Error processing audio: {e}")
            print(f"Stack trace: {traceback.format_exc()}")
            return None

    def _convert_text_to_speech(self, texte):
        texte_brut = self._markdown_to_text(texte)
        texte_brut = self._clean_text(texte_brut)
        
        try:
            tts = gTTS(text=texte_brut, lang=self.tts_lang, slow=False)
            timestamp = int(time.time())
            temp_file = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}.mp3")
            temp_file_fast = os.path.join(self.temp_dir, f"assistant_vocal_{timestamp}_fast.mp3")
            tts.save(temp_file)
            cmd = f"ffmpeg -y -i {temp_file} -filter:a \"atempo={AUDIO_SPEED_FACTOR}\" -vn {temp_file_fast} > /dev/null 2>&1"
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

    def _get_parallel_audio_instruction(self, q):
        while not q.empty():
            current_item = q.get()
            return current_item
        return None

    def _markdown_to_text(self, markdown_text):
        if not markdown_text:
            return ""
            
        # Supprimer complètement les blocs de code
        text = re.sub(r'```[\s\S]*?```', '', markdown_text)
        
        # Supprimer les backticks simples (code inline)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        
        # Supprimer les balises HTML
        text = re.sub(r'<[^>]+>', '', markdown_text)
        
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
    
    def _clean_text(self, texte):
        texte = re.sub(r'(\d+)\.(\d+)', r'\1 virgule \2', texte)
        texte = re.sub(r'(\w+)\.(\w+)', r'\1 point \2', texte)
        return texte
