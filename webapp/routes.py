from flask import jsonify, render_template
from flask_socketio import emit
import threading
import queue
import json

from constants import *

MODEL_REF = [DEFAULT_MODEL]

def process_audio_queue(socketio, audio_queue, is_processing_ref, assistant, model_ref):
    print("🎧 Starting audio processing thread")
    
    while is_processing_ref[0]:
        try:
            audio_data = audio_queue.get(timeout=1)
            
            if audio_data:
                data_size = len(audio_data) if audio_data else 0
                print(f"📥 Audio data received - size: {data_size} bytes")
                user_prompt = assistant.analyser_audio(audio_data)
                print(f"🔊 Texte analysé: {user_prompt}")

                if user_prompt:
                    assistant.obtenir_reponse_ollama_stream(user_prompt, socketio, audio_queue, model_ref)
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

def register_routes(app, socketio, assistant, audio_queue, is_processing_ref, processing_thread_ref, available_models_ref, model_ref):

    selected_model_ref = model_ref

    @app.route('/models')
    def get_models():
        return jsonify({"models": available_models_ref})
        
    @app.route('/current-model')
    def get_current_model():
        return jsonify({"currentModel": selected_model_ref})

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
            if assistant.conversation_history and any(mot in ' '.join(assistant.conversation_history[-2:]).lower() for mot in INTERRUPT_WORDS["fr"] + INTERRUPT_WORDS["en"]):
                assistant.conversation_history = []
                print("Historique de conversation réinitialisé après mot d'arrêt")
            
            processing_thread_ref[0] = threading.Thread(
                target=process_audio_queue, 
                args=(socketio, audio_queue, is_processing_ref, assistant, selected_model_ref)
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
        if model in available_models_ref:
            model_ref = model
            print(f"Modèle changé pour {model_ref}")
            emit('status', {'message': f'Modèle changé pour {model_ref}'})
        else:
            emit('error', {'message': f'Modèle inconnu: {model}'})

    @socketio.on('change_tts_lang')
    def handle_tts_lang_change(data):
        lang = data.get('lang')
        
        if lang in ['fr', 'en']:
            assistant.tts_lang = lang
            
            status_message = RESPONSE_MESSAGES[lang]["language_changed"]
            print(f"Langue changée pour {lang}")
            emit('status', {'message': status_message})
        else:
            error_message = ERROR_MESSAGES[assistant.tts_lang]["language_not_supported"]
            emit('error', {'message': f'{error_message}: {lang}'})
