/**
 * Star Office World — Web Research Tools
 */

import type { ToolDefinition } from "../ToolTypes.js";

export const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web for information using a query string.",
  riskLevel: "low",
  parameters: {
    query: {
      type: "string",
      description: "Search query",
      required: true,
    },
  },
  async execute(args) {
    const query = String(args["query"] ?? "").trim();
    if (!query) {
      return { success: false, output: "", error: "Search query is required." };
    }

    try {
      // Use DuckDuckGo HTML endpoint with standard fetch
      const encoded = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        return {
          success: false,
          output: "",
          error: `Search request failed with HTTP ${res.status}`,
        };
      }

      const html = await res.text();
      // Extract snippet results
      const results: Array<{ title: string; snippet: string; link: string }> = [];
      const linkRegex = /<a class="result__url" href="([^"]+)">/g;
      const snippetRegex = /<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g;

      let linkMatch;
      const links: string[] = [];
      while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 5) {
        links.push(linkMatch[1] ?? "");
      }

      let snippetMatch;
      const snippets: string[] = [];
      while ((snippetMatch = snippetRegex.exec(html)) !== null && snippets.length < 5) {
        const text = snippetMatch[1]!.replace(/<[^>]+>/g, "").trim();
        snippets.push(text);
      }

      for (let i = 0; i < Math.max(links.length, snippets.length, 1); i++) {
        if (links[i] || snippets[i]) {
          results.push({
            title: `Result #${i + 1}`,
            link: links[i] || "",
            snippet: snippets[i] || "",
          });
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `Search for "${query}" completed. (No public search results parsed, external connection active)`,
          data: { query, results: [] },
        };
      }

      const formatted = results
        .map((r, idx) => `[${idx + 1}] ${r.snippet}\nSource: ${r.link}`)
        .join("\n\n");

      return {
        success: true,
        output: formatted,
        data: { query, results },
      };
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: `Search error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const webFetchTool: ToolDefinition = {
  name: "web_fetch",
  description: "Fetch web page content from a public URL and extract clean text.",
  riskLevel: "medium",
  parameters: {
    url: {
      type: "string",
      description: "Full HTTP/HTTPS URL to fetch",
      required: true,
    },
  },
  async execute(args) {
    const url = String(args["url"] ?? "").trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { success: false, output: "", error: "Only http/https URLs are allowed." };
    }

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "StarOfficeAgent/1.0",
        },
      });

      if (!res.ok) {
        return { success: false, output: "", error: `Fetch failed with status ${res.status}` };
      }

      const text = await res.text();
      // Strip scripts, styles, and HTML tags
      const clean = text
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const preview = clean.slice(0, 3000);
      return {
        success: true,
        output: preview,
        data: { url, totalLength: clean.length, truncated: clean.length > 3000 },
      };
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
