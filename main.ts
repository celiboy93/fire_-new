/** @jsxImportSource npm:hono@3/jsx */
import { Hono } from "npm:hono@3";
import { serveStatic } from "npm:hono@3/adapter/deno";

const app = new Hono();

// =======================
// 1. UI INTERFACE (Dark Theme)
// =======================
app.get("/", (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MediaFire Proxy Gen</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet" />
    </head>
    <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-lg bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700">
        <h1 class="text-3xl font-black text-center mb-6 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          <i class="fa-solid fa-fire"></i> MediaFire Proxy
        </h1>

        <div class="space-y-4">
            <div>
                <label class="block text-xs font-bold text-gray-400 mb-1">MediaFire Link</label>
                <input id="mf-link" type="text" placeholder="Paste link here..." class="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition" />
            </div>
            
            <div>
                <label class="block text-xs font-bold text-gray-400 mb-1">File Name (Optional)</label>
                <input id="file-name" type="text" placeholder="e.g. MyMovie.mp4" class="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-sm focus:border-blue-500 outline-none transition" />
            </div>

            <button onclick="generateLink()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition shadow-lg flex items-center justify-center gap-2">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Link
            </button>
        </div>

        <div id="result-area" class="mt-6 hidden">
            <label class="block text-xs font-bold text-green-400 mb-1">Generated Deno Link:</label>
            <div class="flex gap-2">
                <input id="final-link" readonly class="w-full bg-gray-900 border border-green-500/50 rounded-xl px-4 py-3 text-xs font-mono text-gray-300 outline-none" />
                <button onclick="copyLink()" class="bg-gray-700 hover:bg-gray-600 text-white px-4 rounded-xl transition"><i class="fa-regular fa-copy"></i></button>
            </div>
            <div class="mt-4 flex gap-2">
                <a id="test-btn" href="#" target="_blank" class="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2.5 rounded-xl text-center transition">Test Play / DL</a>
            </div>
        </div>
      </div>

      <script>
        function generateLink() {
            const url = document.getElementById('mf-link').value.trim();
            const name = document.getElementById('file-name').value.trim();
            
            if(!url) return alert("Please enter a link!");

            // Create Clean URL
            const baseUrl = window.location.origin + "/stream";
            const finalUrl = baseUrl + "?url=" + encodeURIComponent(url) + (name ? "&name=" + encodeURIComponent(name) : "");
            
            document.getElementById('final-link').value = finalUrl;
            document.getElementById('test-btn').href = finalUrl;
            document.getElementById('result-area').classList.remove('hidden');
        }

        function copyLink() {
            const copyText = document.getElementById("final-link");
            copyText.select();
            document.execCommand("copy");
            alert("Copied to clipboard! ✅");
        }
      </script>
    </body>
    </html>
  `);
});

// =======================
// 2. STREAMING PROXY (With Range Support)
// =======================
app.get("/stream", async (c) => {
    const mfUrl = c.req.query("url");
    const customName = c.req.query("name");
    
    if (!mfUrl) return c.text("Missing URL", 400);

    try {
        // Step 1: Scrape MediaFire for Direct Link
        const pageRes = await fetch(mfUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        const html = await pageRes.text();
        const match = html.match(/aria-label="Download file"\s+href="([^"]+)"/);
        
        if (!match || !match[1]) return c.text("Download link not found (File might be deleted)", 404);
        const directLink = match[1];

        // Step 2: Prepare Headers for Streaming (Seeking Support)
        const rangeHeader = c.req.header("range"); // Browser request range
        const fetchHeaders = new Headers({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        });
        
        // If browser asks for specific part (Seeking), forward it to MediaFire
        if (rangeHeader) {
            fetchHeaders.set("Range", rangeHeader);
        }

        // Step 3: Fetch the Real File
        const fileRes = await fetch(directLink, { headers: fetchHeaders });

        // Step 4: Construct Response Headers
        const newHeaders = new Headers(fileRes.headers);

        // Force Filename (Download Name)
        if (customName) {
            newHeaders.set("Content-Disposition", `attachment; filename="${customName}"`);
        } else {
            // Use original name but ensure it's attachment
            const originalName = directLink.split('/').pop()?.split('?')[0] || "video.mp4";
            newHeaders.set("Content-Disposition", `attachment; filename="${originalName}"`);
        }

        // Essential for Video Player Seeking
        newHeaders.set("Accept-Ranges", "bytes");
        newHeaders.set("Access-Control-Allow-Origin", "*");

        // Step 5: Stream it back
        return new Response(fileRes.body, {
            status: fileRes.status, // 200 or 206 (Partial Content)
            headers: newHeaders
        });

    } catch (e) {
        return c.text("Proxy Error: " + e.message, 500);
    }
});

Deno.serve(app.fetch);
