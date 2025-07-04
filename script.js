/**
 * Debug utility module
 */
class DebugLogger {
    constructor(enabled = false) {
        this.enabled = enabled;
    }

    log(...args) {
        if (this.enabled) {
            console.log(...args);
        }
    }

    error(...args) {
        if (this.enabled) {
            console.error(...args);
        }
    }
}

/**
 * Card data fetcher using Scryfall API
 */
class CardDataFetcher {
    constructor(debugLogger) {
        this.debugLogger = debugLogger;
    }

    async fetchCardInfo(cardName) {
        try {
            const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return this.extractImageUrls(data, cardName);
        } catch (error) {
            this.debugLogger.error('Error fetching card data:', error);
            return { large: '', artCrop: '' };
        }
    }

    extractImageUrls(data, cardName) {
        // Handle normal cards
        if (data.image_uris && data.image_uris.large) {
            return {
                large: data.image_uris.large,
                artCrop: data.image_uris.art_crop
            };
        }
        
        // Handle double-faced cards
        if (data.card_faces && data.card_faces[0].image_uris) {
            return {
                large: data.card_faces[0].image_uris.large,
                artCrop: data.card_faces[0].image_uris.art_crop
            };
        }

        this.debugLogger.log("No image available for " + cardName);
        return { large: '', artCrop: '' };
    }
}

/**
 * File processor for handling decklist files
 */
class DecklistProcessor {
    constructor(debugLogger, cardDataFetcher) {
        this.debugLogger = debugLogger;
        this.cardDataFetcher = cardDataFetcher;
    }

    sanitizeLineEndings(text) {
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    async processFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const sanitizedText = this.sanitizeLineEndings(e.target.result);
                    const lines = sanitizedText.split('\n');
                    this.debugLogger.log('Processing lines:', lines);
                    
                    const cardGroups = await this.parseLines(lines);
                    resolve(cardGroups);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    async parseLines(lines) {
        const cardGroups = [];
        let currentGroup = [];

        for (const line of lines) {
            if (line.trim() === '') {
                if (currentGroup.length > 0) {
                    cardGroups.push(currentGroup);
                    currentGroup = [];
                }
                continue;
            }

            const cardInfo = this.parseLine(line);
            if (cardInfo) {
                const imageData = await this.cardDataFetcher.fetchCardInfo(cardInfo.name);
                currentGroup.push({
                    image: imageData,
                    count: cardInfo.count
                });

                if (currentGroup.length >= 4) {
                    cardGroups.push(currentGroup);
                    currentGroup = [];
                }
            }
        }

        if (currentGroup.length > 0) {
            cardGroups.push(currentGroup);
        }

        return cardGroups;
    }

    parseLine(line) {
        const parts = line.trim().split(/(\d+) (.+)/);
        if (parts.length >= 3) {
            const count = parseInt(parts[1], 10);
            const name = parts[2].toLowerCase();
            this.debugLogger.log(`${count} => ${name}`);
            return { count, name };
        }
        return null;
    }
}

/**
 * UI manager for handling display and interactions
 */
class UIManager {
    constructor(debugLogger) {
        this.debugLogger = debugLogger;
        this.elements = {
            cardContainer: document.getElementById('cardContainer'),
            background: document.getElementById('background'),
            fileInput: document.getElementById('fileInput'),
            logoLink: document.getElementById('logo-link'),
            explanation: document.getElementById('explanation')
        };
    }

    hideInitialElements() {
        const elementsToHide = [this.elements.fileInput, this.elements.logoLink, this.elements.explanation];
        elementsToHide.forEach(element => {
            if (element) {
                element.style.display = 'none';
            }
        });
    }

    updateCardDisplay(cardGroups, currentIndex) {
        const { cardContainer, background } = this.elements;
        
        // Start fade out
        cardContainer.style.opacity = 0;

        setTimeout(() => {
            cardContainer.innerHTML = '';
            let backgroundImageUrl = '';

            if (cardGroups.length > 0 && cardGroups[currentIndex]) {
                cardGroups[currentIndex].forEach(cardData => {
                    const cardElement = this.createCardElement(cardData);
                    cardContainer.appendChild(cardElement);
                    
                    if (!backgroundImageUrl && cardData.image.artCrop) {
                        backgroundImageUrl = cardData.image.artCrop;
                    }
                });

                if (backgroundImageUrl) {
                    background.style.backgroundImage = `url('${backgroundImageUrl}')`;
                }
            }

            // Fade in
            cardContainer.style.opacity = 1;
        }, 200);
    }

    createCardElement(cardData) {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'card-container';

        const img = document.createElement('img');
        img.src = cardData.image.large;
        img.className = 'card-image';
        cardContainer.appendChild(img);

        if (cardData.count > 0) {
            const countLabel = document.createElement('div');
            countLabel.className = 'card-count';
            countLabel.textContent = `${cardData.count}`;
            cardContainer.appendChild(countLabel);
        }

        return cardContainer;
    }
}

/**
 * Navigation controller for keyboard interactions
 */
class NavigationController {
    constructor(debugLogger, onNavigate) {
        this.debugLogger = debugLogger;
        this.onNavigate = onNavigate;
        this.setupKeyboardListeners();
    }

    setupKeyboardListeners() {
        document.body.addEventListener('keydown', (event) => {
            this.debugLogger.log('Key pressed:', event.key);
            
            if (event.key === 'ArrowRight') {
                this.onNavigate('next');
            } else if (event.key === 'ArrowLeft') {
                this.onNavigate('previous');
            }
        });
    }
}

/**
 * Main application controller
 */
class DecktechViewer {
    constructor() {
        this.debugLogger = new DebugLogger(true);
        this.cardDataFetcher = new CardDataFetcher(this.debugLogger);
        this.decklistProcessor = new DecklistProcessor(this.debugLogger, this.cardDataFetcher);
        this.uiManager = new UIManager(this.debugLogger);
        this.navigationController = new NavigationController(this.debugLogger, this.handleNavigation.bind(this));
        
        this.cardGroups = [];
        this.currentIndex = 0;
        
        this.init();
    }

    init() {
        this.setupFileInput();
        this.debugLogger.log('DecktechViewer initialized');
    }

    setupFileInput() {
        const fileInput = document.getElementById('fileInput');
        if (fileInput) {
            fileInput.addEventListener('change', this.handleFileInput.bind(this));
        }
    }

    async handleFileInput(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.uiManager.hideInitialElements();
        
        try {
            this.cardGroups = await this.decklistProcessor.processFile(file);
            this.currentIndex = 0;
            this.updateDisplay();
        } catch (error) {
            this.debugLogger.error('Error processing file:', error);
        }
    }

    handleNavigation(direction) {
        if (this.cardGroups.length === 0) return;

        this.debugLogger.log('Current card groups:', this.cardGroups);
        
        if (direction === 'next') {
            this.currentIndex = (this.currentIndex + 1) % this.cardGroups.length;
        } else if (direction === 'previous') {
            this.currentIndex = (this.currentIndex - 1 + this.cardGroups.length) % this.cardGroups.length;
        }
        
        this.updateDisplay();
    }

    updateDisplay() {
        this.uiManager.updateCardDisplay(this.cardGroups, this.currentIndex);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new DecktechViewer();
}); 