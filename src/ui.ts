function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderIndexHtml(serviceTitle: string): string {
  const safeTitle = escapeHtml(serviceTitle);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root {
      --panel: #ffffff;
      --panel-soft: #f1f5f9;
      --text: #0f172a;
      --muted: #475569;
      --border: #dbe3ed;
      --accent: #0f766e;
      --accent-soft: #ccfbf1;
      --danger: #be123c;
      --shadow: 0 8px 26px rgba(15, 23, 42, 0.08);
      --radius: 12px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%);
      min-height: 100vh;
    }

    .shell {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 16px;
    }

    .toolbar {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 14px;
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr auto auto;
      align-items: center;
    }

    .title {
      font-size: 1.3rem;
      font-weight: 700;
      margin: 0;
    }

    .subtitle {
      margin: 0;
      font-size: 0.9rem;
      color: var(--muted);
    }

    input[type="search"],
    select,
    button {
      border: 1px solid var(--border);
      background: #fff;
      color: var(--text);
      border-radius: 10px;
      padding: 0.6rem 0.8rem;
      font-size: 0.95rem;
    }

    input[type="search"] { width: 100%; }

    button {
      cursor: pointer;
      font-weight: 600;
      background: var(--panel-soft);
    }

    .status {
      font-size: 0.85rem;
      color: var(--muted);
      min-height: 1.1rem;
    }

    .status.error { color: var(--danger); }

    .grid {
      display: grid;
      grid-template-columns: minmax(320px, 420px) 1fr;
      gap: 16px;
      min-height: 70vh;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 300px;
    }

    .modules-panel {
      position: sticky;
      top: 24px;
      max-height: calc(100vh - 48px);
    }

    .panel-header {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      font-weight: 700;
      font-size: 0.95rem;
      background: #fff;
    }

    .list-scroll,
    .detail-scroll {
      overflow: auto;
      max-height: calc(100vh - 240px);
      padding: 10px;
      display: grid;
      gap: 10px;
    }

    .detail-scroll {
      overflow: visible;
      max-height: none;
      height: auto;
      scrollbar-gutter: auto;
      overscroll-behavior: auto;
    }

    .modules-panel .list-scroll {
      max-height: calc(100vh - 130px);
      overflow-y: auto;
      overflow-x: hidden;
    }

    .module-item {
      border: 1px solid var(--border);
      background: #fff;
      border-radius: 10px;
      padding: 10px;
      display: grid;
      gap: 8px;
      cursor: pointer;
      transition: border-color 140ms ease, transform 140ms ease;
    }

    .module-item:hover {
      border-color: #9ca3af;
      transform: translateY(-1px);
    }

    .module-item.active {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-soft);
    }

    .module-key {
      font-weight: 700;
      word-break: break-word;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      border: 1px solid var(--border);
      background: #f8fafc;
    }

    .list-scroll .chip {
      padding: 0.12rem 0.45rem;
      font-size: 0.66rem;
      line-height: 1.2;
    }

    .chip.good {
      background: #ecfeff;
      border-color: #99f6e4;
      color: #115e59;
    }

    .empty {
      padding: 24px;
      color: var(--muted);
      border: 1px dashed var(--border);
      border-radius: 10px;
      text-align: center;
      background: #f8fafc;
    }

    .detail-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
    }

    .detail-card header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: #f8fafc;
      font-size: 0.85rem;
      font-weight: 700;
      color: #334155;
    }

    .detail-card .body {
      padding: 12px;
      display: grid;
      gap: 8px;
    }

    .kv {
      display: grid;
      grid-template-columns: 180px 1fr;
      gap: 10px;
      font-size: 0.9rem;
      align-items: start;
    }

    .kv .k {
      color: var(--muted);
      font-weight: 600;
    }

    pre {
      margin: 0;
      background: #0b1220;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 10px;
      overflow-x: auto;
      overflow-y: visible;
      max-height: none;
      font-size: 12px;
      line-height: 1.45;
    }

    .versions {
      display: grid;
      gap: 10px;
    }

    .version {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      display: grid;
      gap: 8px;
      background: #fff;
    }

    .version-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }

    .row-links {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .row-links a {
      color: #0f766e;
      text-decoration: none;
      font-size: 0.82rem;
      border: 1px solid #99f6e4;
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      background: #f0fdfa;
    }

    .row-links a:hover {
      border-color: #14b8a6;
      color: #0f766e;
    }

    @media (max-width: 980px) {
      .toolbar { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .modules-panel {
        position: static;
        top: auto;
        max-height: none;
      }
      .list-scroll, .detail-scroll { max-height: none; }
      .kv { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="toolbar">
      <div>
        <h1 class="title">${safeTitle}</h1>
        <p class="subtitle">Browse published micro-frontends and inspect versions, integration metadata, and parameters.</p>
      </div>
      <input id="search" type="search" placeholder="Search module key, provider, component type" />
      <div style="display:flex; gap:8px;">
        <select id="channel">
          <option value="all">All channels</option>
          <option value="preview">Preview only</option>
          <option value="prod">Prod only</option>
        </select>
        <button id="refresh" type="button">Refresh</button>
      </div>
      <div id="status" class="status" aria-live="polite"></div>
    </section>

    <section class="grid">
      <article class="panel modules-panel">
        <div class="panel-header" id="moduleCount">Modules</div>
        <div id="moduleList" class="list-scroll"></div>
      </article>

      <article class="panel">
        <div class="panel-header">Details</div>
        <div id="details" class="detail-scroll">
          <div class="empty">Select a module to view metadata.</div>
        </div>
      </article>
    </section>
  </main>

  <script>
    (function () {
      var state = {
        query: "",
        channel: "all",
        modules: [],
        selectedKey: null,
        selectedDetails: null
      };

      var searchEl = document.getElementById("search");
      var channelEl = document.getElementById("channel");
      var refreshEl = document.getElementById("refresh");
      var statusEl = document.getElementById("status");
      var moduleListEl = document.getElementById("moduleList");
      var moduleCountEl = document.getElementById("moduleCount");
      var detailsEl = document.getElementById("details");

      function escapeUnsafe(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function setStatus(message, isError) {
        statusEl.textContent = message || "";
        statusEl.className = isError ? "status error" : "status";
      }

      function toJson(value) {
        try {
          return JSON.stringify(value == null ? {} : value, null, 2);
        } catch (_error) {
          return "{}";
        }
      }

      function chip(label, good) {
        return '<span class="chip' + (good ? ' good' : '') + '">' + escapeUnsafe(label) + '</span>';
      }

      function formatDate(value) {
        if (!value) return "-";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString();
      }

      function fetchJson(path) {
        return fetch(path, { headers: { accept: "application/json" } })
          .then(function (response) {
            return response.text().then(function (text) {
              var payload = text ? JSON.parse(text) : {};
              if (!response.ok) {
                var errorMessage = payload && payload.error ? payload.error : ("Request failed (" + response.status + ")");
                throw new Error(typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage));
              }
              return payload;
            });
          });
      }

      function renderModuleList() {
        moduleCountEl.textContent = "Modules (" + state.modules.length + ")";

        if (!state.modules.length) {
          moduleListEl.innerHTML = '<div class="empty">No modules match current filters.</div>';
          return;
        }

        var html = "";
        for (var i = 0; i < state.modules.length; i += 1) {
          var item = state.modules[i];
          var chips = "";
          if (item.provider) chips += chip("Provider: " + item.provider, false);
          if (item.component_type) chips += chip("Type: " + item.component_type, false);
          if (item.latest_version_preview) chips += chip("preview: " + item.latest_version_preview, true);
          if (item.latest_version_prod) chips += chip("prod: " + item.latest_version_prod, true);
          chips += chip("versions: " + item.versions_total, false);

          html += '<button type="button" class="module-item' + (state.selectedKey === item.module_key ? ' active' : '') + '" data-module-key="' +
            escapeUnsafe(item.module_key) + '">' +
            '<div class="module-key">' + escapeUnsafe(item.module_key) + '</div>' +
            '<div class="chips">' + chips + '</div>' +
            '<div style="font-size:0.78rem; color:#64748b;">Updated: ' + escapeUnsafe(formatDate(item.updated_at)) + '</div>' +
          '</button>';
        }

        moduleListEl.innerHTML = html;
        moduleListEl.querySelectorAll("[data-module-key]").forEach(function (element) {
          element.addEventListener("click", function () {
            var moduleKey = element.getAttribute("data-module-key");
            if (!moduleKey) return;
            loadDetails(moduleKey).catch(function (error) {
              setStatus(error.message || "Failed to load module details.", true);
            });
          });
        });
      }

      function renderDetails() {
        var data = state.selectedDetails;
        if (!data) {
          detailsEl.innerHTML = '<div class="empty">Select a module to view metadata.</div>';
          return;
        }

        var module = data.module || {};
        var latestPreview = data.latest_preview || null;
        var latestProd = data.latest_prod || null;

        var summaryHtml =
          '<section class="detail-card">' +
            '<header>Module Overview</header>' +
            '<div class="body">' +
              '<div class="kv"><div class="k">Module Key</div><div>' + escapeUnsafe(module.module_key || "-") + '</div></div>' +
              '<div class="kv"><div class="k">Provider</div><div>' + escapeUnsafe(module.provider || "-") + '</div></div>' +
              '<div class="kv"><div class="k">Component Type</div><div>' + escapeUnsafe(module.component_type || "-") + '</div></div>' +
              '<div class="kv"><div class="k">Latest Preview</div><div>' + escapeUnsafe(module.latest_version_preview || "-") + '</div></div>' +
              '<div class="kv"><div class="k">Latest Prod</div><div>' + escapeUnsafe(module.latest_version_prod || "-") + '</div></div>' +
              '<div class="kv"><div class="k">Versions</div><div>' + escapeUnsafe(module.versions_total || "0") + '</div></div>' +
              '<div class="kv"><div class="k">Updated</div><div>' + escapeUnsafe(formatDate(module.updated_at)) + '</div></div>' +
            '</div>' +
          '</section>';

        var latestHtml =
          '<section class="detail-card">' +
            '<header>Latest Release Summary</header>' +
            '<div class="body">' +
              '<div class="kv"><div class="k">Preview Integrations</div><div><pre>' + escapeUnsafe(toJson(latestPreview ? latestPreview.integrations : {})) + '</pre></div></div>' +
              '<div class="kv"><div class="k">Preview Parameters</div><div><pre>' + escapeUnsafe(toJson(latestPreview ? latestPreview.parameters : [])) + '</pre></div></div>' +
              '<div class="kv"><div class="k">Prod Integrations</div><div><pre>' + escapeUnsafe(toJson(latestProd ? latestProd.integrations : {})) + '</pre></div></div>' +
              '<div class="kv"><div class="k">Prod Parameters</div><div><pre>' + escapeUnsafe(toJson(latestProd ? latestProd.parameters : [])) + '</pre></div></div>' +
            '</div>' +
          '</section>';

        var versions = Array.isArray(data.versions) ? data.versions : [];
        var versionRows = "";
        for (var i = 0; i < versions.length; i += 1) {
          var version = versions[i] || {};
          var links =
            '<a href="' + escapeUnsafe(version.bundle_url || "#") + '" target="_blank" rel="noopener noreferrer">bundle</a>' +
            '<a href="' + escapeUnsafe(version.manifest_url || "#") + '" target="_blank" rel="noopener noreferrer">manifest</a>';

          if (version.definition_ref && version.definition_ref.url) {
            links += '<a href="' + escapeUnsafe(version.definition_ref.url) + '" target="_blank" rel="noopener noreferrer">definition</a>';
          }
          if (version.seed_ref && version.seed_ref.url) {
            links += '<a href="' + escapeUnsafe(version.seed_ref.url) + '" target="_blank" rel="noopener noreferrer">seed</a>';
          }

          versionRows +=
            '<article class="version">' +
              '<div class="version-head">' +
                '<strong>' + escapeUnsafe(version.module_version || "-") + '</strong>' +
                '<div class="chips">' +
                  chip(version.channel || "-", true) +
                  (version.provider ? chip(version.provider, false) : "") +
                  (version.component_type ? chip(version.component_type, false) : "") +
                '</div>' +
              '</div>' +
              '<div class="row-links">' + links + '</div>' +
              '<div style="font-size:0.82rem; color:#64748b;">Published: ' + escapeUnsafe(formatDate(version.published_at)) + '</div>' +
              '<div style="font-size:0.82rem; color:#64748b;">Updated by: ' + escapeUnsafe(version.updated_by || "-") + '</div>' +
              '<div><pre>' + escapeUnsafe(toJson({
                release: version.release,
                checksums: version.checksums,
                screenshots: version.screenshots
              })) + '</pre></div>' +
            '</article>';
        }

        var historyHtml =
          '<section class="detail-card">' +
            '<header>Version History</header>' +
            '<div class="body versions">' + versionRows + '</div>' +
          '</section>';

        detailsEl.innerHTML = summaryHtml + latestHtml + historyHtml;
      }

      function loadModuleList(keepSelection) {
        setStatus("Loading modules...", false);
        var params = new URLSearchParams();
        if (state.query.trim()) {
          params.set("q", state.query.trim());
        }
        params.set("channel", state.channel);
        params.set("limit", "250");

        return fetchJson("/api/modules?" + params.toString())
          .then(function (data) {
            state.modules = Array.isArray(data.items) ? data.items : [];
            renderModuleList();

            if (keepSelection && state.selectedKey) {
              var exists = state.modules.some(function (item) {
                return item.module_key === state.selectedKey;
              });
              if (exists) {
                return loadDetails(state.selectedKey, true).then(function () {
                  setStatus("Loaded " + state.modules.length + " module(s).", false);
                });
              }
              state.selectedKey = null;
              state.selectedDetails = null;
              renderDetails();
            }

            setStatus("Loaded " + state.modules.length + " module(s).", false);
            return null;
          });
      }

      function loadDetails(moduleKey, skipStatus) {
        if (!skipStatus) {
          setStatus("Loading " + moduleKey + "...", false);
        }

        return fetchJson("/api/modules/" + encodeURIComponent(moduleKey))
          .then(function (data) {
            state.selectedKey = moduleKey;
            state.selectedDetails = data;
            renderModuleList();
            renderDetails();
            if (!skipStatus) {
              setStatus("Loaded " + moduleKey + ".", false);
            }
          });
      }

      var searchTimeout = null;

      searchEl.addEventListener("input", function (event) {
        state.query = event.target.value || "";
        if (searchTimeout) {
          clearTimeout(searchTimeout);
        }
        searchTimeout = setTimeout(function () {
          loadModuleList(false).catch(function (error) {
            setStatus(error.message || "Failed to load modules.", true);
          });
        }, 250);
      });

      channelEl.addEventListener("change", function (event) {
        state.channel = event.target.value || "all";
        loadModuleList(false).catch(function (error) {
          setStatus(error.message || "Failed to load modules.", true);
        });
      });

      refreshEl.addEventListener("click", function () {
        loadModuleList(true).catch(function (error) {
          setStatus(error.message || "Failed to refresh modules.", true);
        });
      });

      loadModuleList(false)
        .then(function () {
          if (state.modules.length > 0) {
            return loadDetails(state.modules[0].module_key, true);
          }
          return null;
        })
        .catch(function (error) {
          setStatus(error.message || "Initial load failed.", true);
        });
    })();
  </script>
</body>
</html>`;
}
