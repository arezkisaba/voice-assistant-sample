OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_TAGS_URL = "http://localhost:11434/api/tags"

DEFAULT_MODEL = "mistral:7b"
DEFAULT_TTS_LANG = "fr"

SYSTEM_PROMPTS = {
    "fr": """Tu es un assistant vocal français intelligent et serviable. 
Réponds en Fançais de manière claire et concise. 
Privilégie la simplicité et la clarté dans tes réponses.""",
    
    "en": """You are a smart and helpful English-speaking voice assistant.
Answer in English in a clear and concise way.
Prioritize simplicity and clarity in your responses."""
}

SYSTEM_PROMPT = SYSTEM_PROMPTS[DEFAULT_TTS_LANG]

ACTIVATION_WORDS = {
    "fr": ["ok stéphane"],
    "en": ["ok stéphane"]
}

INTERRUPT_WORDS = {
    "fr": ["arrête stéphane"],
    "en": ["stop stéphane"]
}

SPEECH_LANG_MAP = {
    "fr": "fr-FR",
    "en": "en-US"
}

ERROR_MESSAGES = {
    "fr": {
        "not_understood": "Je n'ai pas compris ce que vous avez dit",
        "model_communication": "Désolé, j'ai rencontré une erreur de communication avec le modèle.",
        "model_access": "Désolé, je ne peux pas accéder au modèle pour le moment.",
        "language_not_supported": "Langue non prise en charge"
    },
    "en": {
        "not_understood": "I didn't understand what you said",
        "model_communication": "Sorry, I encountered an error communicating with the model.",
        "model_access": "Sorry, I cannot access the model at the moment.",
        "language_not_supported": "Language not supported"
    }
}

RESPONSE_MESSAGES = {
    "fr": {
        "goodbye": "Au revoir! À bientôt.",
        "language_changed": "Langue changée pour le français",
        "response_cancelled": "Génération de réponse arrêtée"
    },
    "en": {
        "goodbye": "Goodbye! See you soon.",
        "language_changed": "Language changed to English",
        "response_cancelled": "Response generation stopped"
    }
}

FLASK_SECRET_KEY = "voiceassistantsecret"

OLLAMA_OPTIONS = {
    "temperature": 0.0,
    "top_p": 0.9
}

AUDIO_SPEED_FACTOR = 1.5