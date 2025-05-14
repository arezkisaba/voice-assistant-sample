from flask import jsonify, render_template
from flask_socketio import emit
import threading
import queue
import json

from constants import *

def process_audio_queue(socketio, audio_queue, is_processing_ref, assistant):
    print("🎧 Starting audio processing thread")
    
    while is_processing_ref[0]:
        try:
            audio_data = audio_queue.get(timeout=1)
            
            if audio_data:
                data_size = len(audio_data) if audio_data else 0
                print(f"📥 Audio data received - size: {data_size} bytes")
                text = assistant.analyser_audio(audio_data)
                print(f"🔊 Texte analysé: {text}")

                if text:
                    activation_words = ACTIVATION_WORDS["fr"] if assistant.tts_lang == "fr" else ACTIVATION_WORDS["en"]
                    has_activation_prefix = any(word in text.lower() for word in activation_words)

                    if has_activation_prefix:
                        socketio.emit('transcript', {'text': text})
                        
                        mots_arret = STOP_WORDS["fr"] if assistant.tts_lang == "fr" else STOP_WORDS["en"]
                        has_activation_prefix = any(mot in text.lower() for mot in mots_arret)
                        if has_activation_prefix:
                            response = RESPONSE_MESSAGES[assistant.tts_lang]["goodbye"]
                            audio_base64, _ = assistant.parler(response)
                            socketio.emit('response', {
                                'text': response,
                                'audio': audio_base64,
                                'lastUserMessage': text,
                                'isComplete': True
                            })
                        
                            is_processing_ref[0] = False
                        else:
                            texte_sans_prefixe = text[len("ok assistant"):].strip() if text.lower().startswith("ok assistant") else text
                            new_func(socketio, assistant, texte_sans_prefixe)
                else:
                    print("❌ Aucun texte n'a pu être extrait de l'audio")
                    error_msg = ERROR_MESSAGES[assistant.tts_lang]["not_understood"]
                    socketio.emit('error', {'message': error_msg})
            else:
                print("⚠️ Audio data empty")
            
            audio_queue.task_done()
        except queue.Empty:
            pass
        except Exception as e:
            import traceback
            print(f"❌ Error in processing thread: {e}")
            print(f"Stack trace: {traceback.format_exc()}")
            error_prefix = "Erreur" if assistant.tts_lang == "fr" else "Error"
            socketio.emit('error', {'message': f'{error_prefix}: {str(e)}'})
            audio_queue.task_done()

def new_func(socketio, assistant, texte):
    assistant.obtenir_reponse_ollama_stream(texte, socketio)

def register_routes(app, socketio, global_assistant, audio_queue, is_processing_ref, processing_thread_ref, available_models_ref, model_ref):
    @app.route('/models')
    def get_models():
        return jsonify({"models": available_models_ref[0]})
        
    @app.route('/current-model')
    def get_current_model():
        return jsonify({"currentModel": model_ref[0]})

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
        if not is_processing_ref[0]:
            is_processing_ref[0] = True
            if global_assistant.conversation_history and any(mot in ' '.join(global_assistant.conversation_history[-2:]).lower() for mot in 
                  STOP_WORDS["fr"] + STOP_WORDS["en"]):
                global_assistant.conversation_history = []
                print("Historique de conversation réinitialisé après mot d'arrêt")
            
            processing_thread_ref[0] = threading.Thread(
                target=process_audio_queue, 
                args=(socketio, audio_queue, is_processing_ref, global_assistant)
            )
            processing_thread_ref[0].daemon = True
            processing_thread_ref[0].start()
        
        emit('listening_started')

    @socketio.on('audio_data')
    def handle_audio_data(data):
        audio_queue.put(data['audio'])

    @socketio.on('change_model')
    def handle_model_change(data):
        model = data.get('model')
        if model in available_models_ref[0]:
            model_ref[0] = model
            print(f"Modèle changé pour {model_ref[0]}")
            emit('status', {'message': f'Modèle changé pour {model_ref[0]}'})
        else:
            emit('error', {'message': f'Modèle inconnu: {model}'})

    @socketio.on('change_tts_lang')
    def handle_tts_lang_change(data):
        lang = data.get('lang')
        
        if lang in ['fr', 'en']:
            global_assistant.tts_lang = lang
            
            status_message = RESPONSE_MESSAGES[lang]["language_changed"]
            print(f"Langue changée pour {lang}")
            emit('status', {'message': status_message})
        else:
            error_message = ERROR_MESSAGES[global_assistant.tts_lang]["language_not_supported"]
            emit('error', {'message': f'{error_message}: {lang}'})

    @socketio.on('text_input')
    def handle_text_input(data):
        texte = data['text']
        
        mots_arret = STOP_WORDS["fr"] if global_assistant.tts_lang == "fr" else STOP_WORDS["en"]
        is_exit_phrase = any(mot in texte.lower() for mot in mots_arret)
        
        if is_exit_phrase:
            response = RESPONSE_MESSAGES[global_assistant.tts_lang]["goodbye"]
            audio_base64, _ = global_assistant.parler(response)
            emit('response', {
                'text': response,
                'audio': audio_base64,
                'lastUserMessage': texte,
                'isComplete': True
            })

            is_processing_ref[0] = False
        else:
            global_assistant.obtenir_reponse_ollama_stream(texte, socketio)

    @socketio.on('cancel_response')
    def handle_cancel_response():
        CANCEL_SPEECH_SYNTHESIS[0] = True
        # Activer le drapeau d'annulation du streaming de réponse
        CANCEL_RESPONSE_STREAMING[0] = True
        
        if is_processing_ref[0]:
            is_processing_ref[0] = False
        
        while not audio_queue.empty():
            try:
                audio_queue.get_nowait()
                audio_queue.task_done()
            except queue.Empty:
                break
        
        status_message = RESPONSE_MESSAGES[global_assistant.tts_lang]["response_cancelled"]
        print("Génération de réponse annulée par l'utilisateur")
        emit('status', {'message': status_message})