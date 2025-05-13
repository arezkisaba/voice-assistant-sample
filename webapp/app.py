import requests
import queue
from flask import Flask
from flask_socketio import SocketIO
from constants import *
from routes import register_routes
from webassistant import WebAssistant

AVAILABLE_MODELS = [{}]
MODEL_REF = [DEFAULT_MODEL]

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = FLASK_SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins="*")

audio_queue = queue.Queue()
is_processing_ref = [False]
processing_thread_ref = [None]

global_assistant = None

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