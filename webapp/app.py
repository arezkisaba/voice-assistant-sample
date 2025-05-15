import requests
import queue
from flask import Flask
from flask_socketio import SocketIO
from constants import *
from routes import register_routes
from webassistant import WebAssistant

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = FLASK_SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins="*")

audio_queue = queue.Queue()
is_processing_ref = [False]
processing_thread_ref = [None]

global_assistant = None

def verifier_ollama():
    try:
        model_ref = DEFAULT_MODEL
        response = requests.get(OLLAMA_TAGS_URL)
        if response.status_code != 200:
            return False, "Ollama n'est pas accessible"
        
        models = response.json().get("models", [])
        available_models_ref = {}
        for model in models:
            model_name = model.get("name")
            if ':' in model_name:
                available_models_ref[model_name] = model_name
            else:
                model_tag = model.get("tag")
                full_model_name = f"{model_name}:{model_tag}" if model_tag != "latest" else model_name
                available_models_ref[full_model_name] = full_model_name
        
        if model_ref not in available_models_ref:
            return False, f"Le modèle {model_ref} n'est pas téléchargé. Exécutez: ollama pull {model_ref}"
        
        return True, "OK", available_models_ref, model_ref
    except Exception as e:
        return False, f"Erreur lors de la vérification d'Ollama: {e}"

if __name__ == '__main__':
    
    ollama_ok, message, models_dict, model_ref = verifier_ollama()
    global_assistant = WebAssistant()
    register_routes(
        app, 
        socketio, 
        global_assistant, 
        audio_queue, 
        is_processing_ref, 
        processing_thread_ref, 
        models_dict, 
        model_ref
    )

    if not ollama_ok:
        print(f"❌ {message}")
    else:
        print(f"✅ Ollama est prêt avec le modèle {model_ref}")
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