/** @jsxImportSource npm:hono@3/jsx */
import { Hono } from "npm:hono@3";
import { getCookie, setCookie } from "npm:hono@3/cookie";

const app = new Hono();
// Deno KV Database ဖွင့်ခြင်း (Link တွေမှတ်ထားဖို့)
const kv = await Deno.openKv();

// =======================
// CONFIGURATION
// =======================
const ACCESS_PASSWORD = "Soekyawwin@93"; // Login Password ပြောင်းပါ

// =======================
// 1. AUTH & UI
// =======================
app.get("/", (c) => {
  const auth = getCookie(c, "auth_token");
  if (auth === ACCESS_PASSWORD) return c.html(renderApp());
  return c.html(renderLogin());
});

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  if (body.password === ACCESS_PASSWORD) {
    setCookie(c, "auth_token", ACCESS_PASSWORD, { path: "/", maxAge: 86400 * 7 }); // 7 Days
    return c.redirect("/");
  }
  return c.html(renderLogin(true));
});

app.get("/logout", (c) => {
    setCookie(c, "auth_token", "", { maxAge: 0 });
    return c.redirect("/");
});

// =======================
// 2. CREATE LINK (SAVE TO DB)
// =======================
app.post("/api/create", async (c) => {
    const auth = getCookie(c, "auth_token");
    if (auth !== ACCESS_PASSWORD) return c.json({ success: false, error: "Unauthorized" }, 401);

    const body = await c.req.parseBody();
    const mfUrl = body.url;
    let fileName = body.name;

    if (!mfUrl || !mfUrl.includes("mediafire.com")) {
        return c.json({ success: false, error: "Invalid MediaFire Link" });
    }

    // ဖိုင်နာမည်ကို သန့်ရှင်းရေးလုပ်ခြင်း (Space တွေဖယ်မယ်, .mp4 မပါရင်ထည့်မယ်)
    fileName = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "_"); 
    if (!fileName.endsWith(".mp4") && !fileName.endsWith(".mkv")) {
        fileName += ".mp4";
    }

    // Database ထဲသိမ်းမယ် (Key: fileName, Value: mfUrl)
    // ဝင်လာတဲ့ နာမည်က ရှိပြီးသားလား အရင်စစ်မယ်
    const existing = await kv.get(["media", fileName]);
    if (existing.value) {
        return c.json({ success: false, error: "This filename already exists! Choose another." });
    }

    await kv.set(["media", fileName], mfUrl);

    // Link အသစ်ပြန်ပို့မယ်
    const fullUrl = new URL(c.req.url).origin + "/" + fileName;
    return c.json({ success: true, link: fullUrl });
});

// =======================
// 3. STREAMING PROXY (The Clean Link Handler)
// =======================
// ဒီ Route က နောက်ဆုံးမှထားရမယ် (Wildcard catch-all)
app.get("/:filename", async (c) => {
    const filename = c.req.param("filename");

    // 1. Database ထဲမှာ ဒီနာမည်နဲ့ Link ရှိမရှိရှာမယ်
    const entry = await kv.get(["media", filename]);
    const mfUrl = entry.value;

    if (!mfUrl) return c.text("404 - File Not Found in Database", 404);

    // 2. ရှိရင် MediaFire ကို လှမ်းဆွဲမယ် (Proxy Logic)
    try {
        const pageRes = await fetch(mfUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });
        
        if (!pageRes.ok) return c.text("MediaFire Connection Failed", 502);
        const html = await pageRes.text();
        
        // Scraping Logic
        let directLink = null;
        let match = html.match(/aria-label="Download file"\s+href="([^"]+)"/);
        if (!match) match = html.match(/id="downloadButton"\s+href="([^"]+)"/);
        
        if (match && match[1]) {
            directLink = match[1];
        } else {
            return c.text("Original File removed or blocked by MediaFire", 404);
        }

        // Streaming Logic
        const rangeHeader = c.req.header("range");
        const fetchHeaders = new Headers({ "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
        if (rangeHeader) fetchHeaders.set("Range", rangeHeader);

        const fileRes = await fetch(directLink, { headers: fetchHeaders });
        const newHeaders = new Headers();
        
        // Copy Headers
        ["content-type", "content-length", "content-range", "accept-ranges"].forEach(h => {
            if (fileRes.headers.has(h)) newHeaders.set(h, fileRes.headers.get(h));
        });

        // Set Filename explicitly
        newHeaders.set("Content-Disposition", `attachment; filename="${filename}"`);
        newHeaders.set("Access-Control-Allow-Origin", "*");
        newHeaders.set("Accept-Ranges", "bytes");

        return new Response(fileRes.body, {
            status: fileRes.status,
            headers: newHeaders
        });

    } catch (e) {
        return c.text("Stream Error", 500);
    }
});

// =======================
// UI HTML PARTS
// =======================

function renderLogin(error = false) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center">
      <div class="w-full max-w-sm bg-gray-800 p-8 rounded-xl border border-gray-700 text-center">
        <h2 class="text-xl font-bold mb-4">🔐 Admin Access</h2>
        ${error ? '<p class="text-red-500 text-sm mb-4">Wrong Password!</p>' : ''}
        <form action="/login" method="POST" class="space-y-4">
            <input type="password" name="password" placeholder="Password" class="w-full bg-gray-900 border border-gray-600 rounded px-4 py-2" required />
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded font-bold">Login</button>
        </form>
      </div>
    </body>
    </html>
  `;
}

function renderApp() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Clean Link Gen</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet" />
    </head>
    <body class="bg-gray-900 text-white min-h-screen flex items-center justify-center p-4">
      <div class="w-full max-w-lg bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700 relative">
        <a href="/logout" class="absolute top-4 right-4 text-gray-500 hover:text-white text-xs">Logout</a>
        
        <h1 class="text-2xl font-bold text-center mb-6 text-blue-400">
          <i class="fa-solid fa-cloud"></i> Clean Link Generator
        </h1>

        <div class="space-y-4">
            <div>
                <label class="text-xs font-bold text-gray-400">MediaFire URL</label>
                <input id="mf-link" type="text" placeholder="https://mediafire.com/..." class="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm mt-1" />
            </div>
            
            <div>
                <label class="text-xs font-bold text-gray-400">Custom Filename</label>
                <input id="file-name" type="text" placeholder="MyMovie (No need .mp4)" class="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm mt-1" />
                <p class="text-[10px] text-gray-500 mt-1">* This will be your link endpoint (e.g. domain.com/MyMovie.mp4)</p>
            </div>

            <button id="gen-btn" onclick="saveLink()" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 rounded-lg transition mt-2">
                Create Short Link
            </button>
        </div>

        <div id="result-area" class="mt-6 hidden">
            <div class="bg-black/30 p-4 rounded-lg border border-green-500/30">
                <label class="text-xs font-bold text-green-400">Success! Your Clean Link:</label>
                <div class="flex gap-2 mt-2">
                    <input id="final-link" readonly class="w-full bg-transparent text-sm font-mono text-white outline-none" />
                    <button onclick="copyLink()" class="text-gray-400 hover:text-white"><i class="fa-regular fa-copy"></i></button>
                </div>
            </div>
            <a id="test-btn" href="#" target="_blank" class="block mt-3 text-center text-xs text-blue-400 hover:underline">Test Link</a>
        </div>
      </div>

      <script>
        async function saveLink() {
            const url = document.getElementById('mf-link').value.trim();
            const name = document.getElementById('file-name').value.trim();
            const btn = document.getElementById('gen-btn');

            if(!url || !name) return alert("Please fill both fields!");

            btn.innerText = "Saving...";
            btn.disabled = true;

            try {
                const res = await fetch("/api/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({ url, name })
                });
                const data = await res.json();

                if(data.success) {
                    document.getElementById('final-link').value = data.link;
                    document.getElementById('test-btn').href = data.link;
                    document.getElementById('result-area').classList.remove('hidden');
                } else {
                    alert("Error: " + data.error);
                }
            } catch(e) {
                alert("Connection Error");
            }

            btn.innerText = "Create Short Link";
            btn.disabled = false;
        }

        function copyLink() {
            const copyText = document.getElementById("final-link");
            copyText.select();
            document.execCommand("copy");
            alert("Copied!");
        }
      </script>
    </body>
    </html>
  `;
}

Deno.serve(app.fetch);
