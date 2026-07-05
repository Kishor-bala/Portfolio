function parseMarkdown(text) {
    if (!text) return '';
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    html = html.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
        const level = hashes.length;
        return '<h' + level + '>' + content + '</h' + level + '>';
    });

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    const lines = html.split('\n');
    let inList = false;
    let listType = null;
    let parsedLines = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line.startsWith('* ') || line.startsWith('- ')) {
            const content = line.substring(2);
            if (!inList || listType !== 'ul') {
                if (inList) parsedLines.push('</' + listType + '>');
                parsedLines.push('<ul>');
                inList = true;
                listType = 'ul';
            }
            parsedLines.push('<li>' + content + '</li>');
        } else if (/^\d+\.\s/.test(line)) {
            const content = line.replace(/^\d+\.\s/, '');
            if (!inList || listType !== 'ol') {
                if (inList) parsedLines.push('</' + listType + '>');
                parsedLines.push('<ol>');
                inList = true;
                listType = 'ol';
            }
            parsedLines.push('<li>' + content + '</li>');
        } else {
            if (inList) {
                parsedLines.push('</' + listType + '>');
                inList = false;
                listType = null;
            }
            parsedLines.push(line);
        }
    }
    if (inList) parsedLines.push('</' + listType + '>');
    html = parsedLines.join('\n');

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
        const cleanUrl = url.replace(/&amp;/g, '&');
        return '<a href="' + cleanUrl + '" target="_blank">' + linkText + '</a>';
    });

    return html.split('\n').map(line => {
        if (line.startsWith('<ul') || line.startsWith('<ol') || line.startsWith('</ul') || line.startsWith('</ol') || line.startsWith('<li') || line.startsWith('<h') || line.startsWith('</h')) {
            return line;
        }
        return line + '<br>';
    }).join('\n').replace(/(<br>\n?)+/g, '<br>');
}

const input = '**Contact Information**\nTo get in touch with me regarding Kishor Bala\'s portfolio, you can reach out through his professional networks. \n[LinkedIn](https://www.linkedin.com/in/kishor-bala-g-a28a23257/)  \n[GitHub](https://github.com/Kishor-bala)  \n[Email](mailto:kishorbala003@gmail.com)';
console.log('OUTPUT HTML:');
console.log(parseMarkdown(input));
