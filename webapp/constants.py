OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_TAGS_URL = "http://localhost:11434/api/tags"

DEFAULT_MODEL = "llama3.1:8b"
DEFAULT_TTS_LANG = "fr"

SYSTEM_PROMPTS = {
    "fr": """Tu es un assistant vocal français intelligent et serviable. 
Réponds de manière claire et concise. 
Privilégie la simplicité et la clarté dans tes réponses.""",
    
    "en": """You are a smart and helpful English-speaking voice assistant.
Answer in a clear and concise way.
Prioritize simplicity and clarity in your responses."""
}

SYSTEM_PROMPT = SYSTEM_PROMPTS[DEFAULT_TTS_LANG]

STOP_WORDS = {
    "fr": ["au revoir", "arrête", "stop", "termine", "bye", "goodbye", "exit", "quit", "ciao"],
    "en": ["goodbye", "bye", "stop", "end", "terminate", "exit", "quit", "ciao"]
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
        "speech_cancelled": "Synthèse vocale annulée"
    },
    "en": {
        "goodbye": "Goodbye! See you soon.",
        "language_changed": "Language changed to English",
        "speech_cancelled": "Speech synthesis cancelled"
    }
}

FLASK_SECRET_KEY = "voiceassistantsecret"

OLLAMA_OPTIONS = {
    "temperature": 0.7,
    "top_p": 0.9
}

AUDIO_SPEED_FACTOR = 1.5

# Flag pour gérer l'annulation de la synthèse vocale
CANCEL_SPEECH_SYNTHESIS = [False]