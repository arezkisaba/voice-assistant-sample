import config from './config.js';
import uiController from './ui-controller.js';
import socketManager from './socket-manager.js';

class ModelsManager {
    constructor() {
        this.modelSelector = null;
        this.availableModels = {};
    }
    
    init() {
        this.modelSelector = document.getElementById('model-selector');
        this.loadAvailableModels();
    }

    loadAvailableModels() {
        fetch('/current-model')
            .then(response => response.json())
            .then(data => {
                config.currentModel = data.currentModel;
                console.log("Modèle actuel défini par le serveur:", config.currentModel);
                return fetch('/models');
            })
            .then(response => response.json())
            .then(data => {
                this.availableModels = data.models;
                this.populateModelSelector(this.availableModels, config.currentModel);
            })
            .catch(error => {
                console.error('Erreur lors du chargement des modèles:', error);
                uiController.setStatus('Erreur lors du chargement des modèles', true);
            });
    }

    populateModelSelector(models, defaultModel) {
        if (!this.modelSelector) return;
        
        this.modelSelector.innerHTML = '';
        
        if (Object.keys(models).length > 0) {
            for (const [id, name] of Object.entries(models)) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = name;
                
                if (id === defaultModel) {
                    option.selected = true;
                }
                
                this.modelSelector.appendChild(option);
            }
        } else {
            const option = document.createElement('option');
            option.value = 'default';
            option.textContent = 'Aucun modèle disponible';
            this.modelSelector.appendChild(option);
            this.modelSelector.disabled = true;
        }
        
        this.modelSelector.addEventListener('change', this.handleModelChange.bind(this));
    }

    handleModelChange(event) {
        config.currentModel = event.target.value;
        const selectedModelName = this.availableModels[config.currentModel] || 'Modèle inconnu';
        socketManager.changeModel(config.currentModel);
        uiController.setStatus(`Modèle changé pour ${selectedModelName}`);
    }
}

const modelsManager = new ModelsManager();
export default modelsManager;