// Minecraft Portfolio Assistant - Frontend Script
(function() {
    let history = [];
    let isGenerating = false;

    // API Base URL (adjusts dynamically if hosted or local file:// protocol)
    const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:8080' : '';

    // DOM Elements
    const chatbotToggleBtn = document.getElementById('chatbot-toggle-btn');
    const chatbotPanel = document.getElementById('chatbot-panel');
    const chatbotCloseBtn = document.getElementById('chatbot-close-btn');
    const chatbotMessages = document.getElementById('chatbot-messages');
    const chatbotForm = document.getElementById('chatbot-form');
    const chatbotInput = document.getElementById('chatbot-input');
    const chatbotPromptBubble = document.getElementById('chatbot-prompt-bubble');

    // Ensure elements exist before binding
    if (!chatbotToggleBtn || !chatbotPanel || !chatbotCloseBtn || !chatbotMessages || !chatbotForm || !chatbotInput) {
        console.warn('Portfolio Assistant: Missing required chatbot UI elements.');
        return;
    }

    // Toggle Chat Panel visibility
    chatbotToggleBtn.addEventListener('click', () => {
        chatbotPanel.classList.toggle('hidden');
        if (!chatbotPanel.classList.contains('hidden')) {
            chatbotInput.focus();
            scrollToBottom();
            if (chatbotPromptBubble) chatbotPromptBubble.classList.add('hidden');
        } else {
            if (chatbotPromptBubble) chatbotPromptBubble.classList.remove('hidden');
        }
    });

    chatbotCloseBtn.addEventListener('click', () => {
        chatbotPanel.classList.add('hidden');
        if (chatbotPromptBubble) chatbotPromptBubble.classList.remove('hidden');
    });

    // Handle Suggestions Click
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('sug-chip')) {
            const question = e.target.getAttribute('data-question');
            if (question && !isGenerating) {
                chatbotInput.value = question;
                chatbotForm.requestSubmit();
            }
        }
    });

    // Form Submission
    chatbotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = chatbotInput.value.trim();
        if (!message || isGenerating) return;

        isGenerating = true;
        chatbotInput.value = '';

        // Append User bubble
        const userBubble = appendMessage('user', message);
        const userWrapper = userBubble.parentElement;

        // Remove previous suggestion chips if they exist at the very bottom
        const oldSuggestions = chatbotMessages.querySelector('.chatbot-suggestions');
        if (oldSuggestions) {
            oldSuggestions.remove();
        }

        // Append typing indicator bubble
        const bubbleEl = appendMessage('assistant', '');
        bubbleEl.innerHTML = `
            <div class="typing-indicator-wrapper">
                <div class="minecraft-spinner"></div>
            </div>
        `;
        scrollToBottom();

        try {
            // Format history for server api (role: user/model)
            const apiHistory = history.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                text: msg.text
            }));

            // Post request to backend
            const response = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    history: apiHistory
                })
            });

            const data = await response.json();

            if (data.status === 'success') {
                const reply = data.reply;
                
                // Clear typing spinner
                bubbleEl.innerHTML = '';
                
                // Parse suggestions and clean text
                const parsed = extractSuggestionsAndClean(reply);
                
                // Type reply content
                await typeWriterEffect(bubbleEl, parsed.cleanText, userWrapper);
                
                // Render suggestions chips
                if (parsed.suggestions.length > 0) {
                    const sugContainer = document.createElement('div');
                    sugContainer.className = 'chatbot-suggestions';
                    parsed.suggestions.forEach(sugText => {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'sug-chip';
                        btn.setAttribute('data-question', sugText);
                        btn.innerHTML = `<span class="icon">➜</span> ${sugText}`;
                        sugContainer.appendChild(btn);
                    });
                    chatbotMessages.appendChild(sugContainer);
                }

                // Add to history list
                history.push({ role: 'user', text: message });
                history.push({ role: 'assistant', text: reply });
                
                scrollToQuestion(userWrapper);
            } else {
                bubbleEl.innerHTML = `<span class="error-msg">⚠️ Error: ${data.message}</span>`;
            }
        } catch (err) {
            bubbleEl.innerHTML = `<span class="error-msg">⚠️ Connection failed. Is the server running?</span>`;
            console.error(err);
        } finally {
            isGenerating = false;
        }
    });

    // Helper: Append Message Bubble
    function appendMessage(role, text) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        
        if (role === 'user') {
            bubble.textContent = text;
        } else if (text) {
            const parsed = extractSuggestionsAndClean(text);
            bubble.innerHTML = parseMarkdown(parsed.cleanText);
        }

        wrapper.appendChild(bubble);
        chatbotMessages.appendChild(wrapper);
        scrollToBottom();

        return bubble;
    }

    // Helper: Auto Scroll logs
    function scrollToBottom() {
        chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    }

    function scrollToQuestion(userWrapper) {
        if (!userWrapper) return;
        const targetScrollTop = userWrapper.getBoundingClientRect().top - chatbotMessages.getBoundingClientRect().top + chatbotMessages.scrollTop;
        chatbotMessages.scrollTo({
            top: targetScrollTop - 10,
            behavior: 'smooth'
        });
    }

    // Parse suggestions matching [Suggestion: ...]
    function extractSuggestionsAndClean(text) {
        const suggestionRegex = /\[Suggestion:\s*(.*?)\]/g;
        const suggestions = [];
        let match;
        while ((match = suggestionRegex.exec(text)) !== null) {
            suggestions.push(match[1].trim());
        }
        const cleanText = text.replace(suggestionRegex, '').trim();
        return { cleanText, suggestions };
    }

    // Typewriter effect streaming simulation
    function typeWriterEffect(element, text, userWrapper) {
        return new Promise((resolve) => {
            const html = parseMarkdown(text);
            element.style.opacity = '0';
            element.innerHTML = html;
            
            element.style.transition = 'opacity 0.2s ease';
            setTimeout(() => {
                element.style.opacity = '1';
                if (userWrapper) {
                    scrollToQuestion(userWrapper);
                } else {
                    scrollToBottom();
                }
                resolve();
            }, 50);
        });
    }

    // Helper: Markdown parser
    function parseMarkdown(text) {
        if (!text) return '';
        let html = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Headers
        html = html.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
            const level = hashes.length;
            return `<h${level}>${content}</h${level}>`;
        });

        // Bold (**text**)
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Lists (* or -)
        const lines = html.split('\n');
        let inList = false;
        let listType = null;
        let parsedLines = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (line.startsWith('* ') || line.startsWith('- ')) {
                const content = line.substring(2);
                if (!inList || listType !== 'ul') {
                    if (inList) parsedLines.push(`</${listType}>`);
                    parsedLines.push('<ul>');
                    inList = true;
                    listType = 'ul';
                }
                parsedLines.push(`<li>${content}</li>`);
            } else if (/^\d+\.\s/.test(line)) {
                const content = line.replace(/^\d+\.\s/, '');
                if (!inList || listType !== 'ol') {
                    if (inList) parsedLines.push(`</${listType}>`);
                    parsedLines.push('<ol>');
                    inList = true;
                    listType = 'ol';
                }
                parsedLines.push(`<li>${content}</li>`);
            } else {
                if (inList) {
                    parsedLines.push(`</${listType}>`);
                    inList = false;
                    listType = null;
                }
                parsedLines.push(line);
            }
        }
        if (inList) parsedLines.push(`</${listType}>`);
        html = parsedLines.join('\n');

        // Link ([text](url))
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
            const cleanUrl = url.replace(/&amp;/g, '&');
            return `<a href="${cleanUrl}" target="_blank">${linkText}</a>`;
        });

        // Convert line breaks
        return html.split('\n').map(line => {
            if (line.startsWith('<ul') || line.startsWith('<ol') || line.startsWith('</ul') || line.startsWith('</ol') || line.startsWith('<li') || line.startsWith('<h') || line.startsWith('</h')) {
                return line;
            }
            return line + '<br>';
        }).join('\n').replace(/(<br>\n?)+/g, '<br>');
    }
})();
