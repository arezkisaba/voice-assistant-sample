from flask import jsonify, render_template
from flask_socketio import emit
import threading
import queue

from constants import *

def process_audio_queue(socketio, audio_queue, is_processing_ref, assistant):
    while is_processing_ref[0]:
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
            processing_thread_ref[0] = threading.Thread(
                target=process_audio_queue, 
                args=(socketio, audio_queue, is_processing_ref, global_assistant)
            )
            processing_thread_ref[0].daemon = True
            processing_thread_ref[0].start()
        
        emit('listening_started')

    @socketio.on('stop_listening')
    def handle_stop_listening():
        is_processing_ref[0] = False
        emit('listening_stopped')

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
                'lastUserMessage': texte
            })
        else:
            response = global_assistant.obtenir_reponse_ollama(texte)
            audio_base64, _ = global_assistant.parler(response)
            emit('response', {
                'text': response,
                'audio': audio_base64,
                'lastUserMessage': texte
            })
            
    @socketio.on('cancel_speech')
    def handle_cancel_speech():
        """Annuler la synthèse vocale en cours"""
        CANCEL_SPEECH_SYNTHESIS[0] = True
        status_message = RESPONSE_MESSAGES[global_assistant.tts_lang]["speech_cancelled"]
        print("Synthèse vocale annulée par l'utilisateur")
        emit('status', {'message': status_message})