# Description

This project implements a French voice assistant using Python, Ollama, and the Gemma 3:12B language model. The assistant can:

- Listen to your voice commands in French and English
- Process your requests through the Gemma 3:12B model
- Respond verbally in French with clear and concise answers
- Exit when hearing commands like "au revoir", "stop", "bye", etc.

It features optimized audio detection with noise suppression and enhanced French language recognition.

# Setup

## Python3.11 virtual environment creation (Windows)
```bash
python.exe -m venv py_311
.\py_311\Scripts\activate
python --version
```

## Python3.11 virtual environment creation (Linux)
```bash
python3.11 -m venv py_311
source ./py_311/bin/activate
python3.11 --version
```

## Dependencies installation
```bash
pip install --upgrade pip
pip install --upgrade setuptools
pip install --upgrade wheel
pip install -r ./requirements.txt
```

# Dataset generation & Training
## Openimages backgrounds download
```bash
python3.11 ./src/scripts/main.py
````