import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import { DOMParser, parseHTML } from 'linkedom';
import JSZip from 'jszip';
import { readRequestBodyCapped } from '../common/request.js';
import { RobosaServiceError } from './service.js';
import { MAX_KNOWLEDGE_TEXT, safeSourceUrl } from './knowledgeStore.js';

export const KNOWLEDGE_FILE_LIMIT = 8 * 1024 * 1024;
const fail = (message, status = 400) => {
  throw new RobosaServiceError(status, 'KNOWLEDGE_IMPORT_FAILED', message);
};

function validateText(text) {
  const value = String(text || '')
    .replace(/\u0000/g, '')
    .trim();
  if (value.length < 20)
    fail(
      'No readable text was found. For scanned documents, paste the text or upload a searchable PDF.',
    );
  if (value.length > MAX_KNOWLEDGE_TEXT)
    fail(
      'This document is too long. Split it into sources of up to 100,000 characters.',
    );
  return value;
}

export function extractWebText(html) {
  const { document } = parseHTML(html);
  document
    .querySelectorAll(
      'script,style,noscript,nav,footer,header,aside,form,svg,template',
    )
    .forEach((node) => node.remove());
  const root =
    document.querySelector('article,main,[role="main"]') ||
    document.body ||
    document.documentElement;
  root
    .querySelectorAll('h1,h2,h3,h4,p,li,div,section,br,tr')
    .forEach((node) => {
      node.append(document.createTextNode('\n'));
    });
  const title =
    document.querySelector('title')?.textContent?.trim() || 'Web page';
  return {
    title: title.slice(0, 160),
    text: validateText(
      root.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n'),
    ),
  };
}

export async function extractKnowledgeFile(buffer, filename) {
  if (!buffer.length || buffer.length > KNOWLEDGE_FILE_LIMIT)
    fail('Choose a document of up to 8 MB.', 413);
  const extension = String(filename || '')
    .split('.')
    .at(-1)
    .toLowerCase();
  let text = '';
  if (['txt', 'md'].includes(extension)) {
    if (buffer.includes(0)) fail('This file is not a text document.');
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } else if (extension === 'html' || extension === 'htm') {
    return extractWebText(buffer.toString('utf8'));
  } else if (extension === 'docx') {
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.values(zip.files).filter((file) => !file.dir);
    if (
      files.length > 500 ||
      files.reduce(
        (sum, file) => sum + (file._data?.uncompressedSize || 0),
        0,
      ) >
        20 * 1024 * 1024
    )
      fail('The DOCX archive is too large after extraction.');
    const main = zip.file('word/document.xml');
    if (!main) fail('This is not a valid DOCX document.');
    const xml = await main.async('string');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    text = Array.from(doc.getElementsByTagName('w:p'))
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagName('w:t'))
          .map((node) => node.textContent)
          .join(''),
      )
      .join('\n\n');
  } else if (extension === 'pdf') {
    if (buffer.subarray(0, 5).toString() !== '%PDF-')
      fail('This is not a valid PDF.');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      standardFontDataUrl: fileURLToPath(
        new URL(
          '../../../node_modules/pdfjs-dist/standard_fonts/',
          import.meta.url,
        ),
      ),
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100)
        fail('Split PDFs longer than 100 pages into smaller documents.');
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(
          content.items
            .map((item) =>
              item.str ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '',
            )
            .join(''),
        );
        if (
          pages.reduce((sum, value) => sum + value.length, 0) >
          MAX_KNOWLEDGE_TEXT
        )
          fail('This PDF is too long. Split it into smaller documents.');
        page.cleanup();
      }
      text = pages.join('\n\n');
    } finally {
      await task.destroy();
    }
  } else fail('Supported documents: PDF, DOCX, TXT, Markdown, and HTML.', 415);
  return {
    title: String(filename || 'Document').slice(0, 160),
    text: validateText(text),
  };
}

export async function readKnowledgeDocument(request, filename) {
  try {
    return await extractKnowledgeFile(
      await readRequestBodyCapped(request, KNOWLEDGE_FILE_LIMIT),
      filename,
    );
  } catch (error) {
    if (error instanceof RobosaServiceError) throw error;
    if (error?.code === 'BODY_TOO_LARGE')
      fail('Choose a document of up to 8 MB.', 413);
    fail(
      'The document could not be read. Try a searchable PDF, DOCX, or plain text file.',
    );
  }
}

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  // Global unicast only; excludes loopback, link-local, private, and mapped IPv4.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(db8|0):/i.test(address) &&
    !/^2002:/i.test(address)
  );
}

export async function validateImportUrl(value, lookupImpl = lookup) {
  if (!value) fail('Enter a public HTTPS page URL.');
  const url = new URL(safeSourceUrl(value));
  if (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'))
    fail(
      'For LinkedIn, upload your exported profile PDF or paste the profile text.',
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookupImpl(hostname, { all: true }).catch(() =>
        fail('The website address could not be resolved.'),
      );
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    fail('Only public website addresses can be imported.');
  return { url, address: addresses[0] };
}

export async function importKnowledgeUrl(
  value,
  { lookupImpl = lookup, requestImpl = httpsRequest } = {},
) {
  let current = value;
  for (let redirect = 0; redirect < 4; redirect++) {
    const { url, address } = await validateImportUrl(current, lookupImpl);
    const result = await new Promise((resolve, reject) => {
      let timer;
      const finish = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      const failed = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      const req = requestImpl(
        url,
        {
          headers: {
            'User-Agent': 'RobosaKnowledgeImporter/1.0',
            Accept: 'text/html,text/plain',
            'Accept-Encoding': 'identity',
          },
          lookup: (_hostname, options, callback) =>
            options?.all
              ? callback(null, [address])
              : callback(null, address.address, address.family),
        },
        (response) => {
          const status = response.statusCode || 0;
          if (
            [301, 302, 303, 307, 308].includes(status) &&
            response.headers.location
          ) {
            response.resume();
            try {
              finish({
                redirect: new URL(response.headers.location, url).href,
              });
            } catch {
              failed(new Error('The website returned an invalid redirect.'));
            }
            return;
          }
          if (status !== 200) {
            response.resume();
            failed(new Error('This page is unavailable or requires sign-in.'));
            return;
          }
          const type = String(response.headers['content-type'] || '');
          if (!/text\/(html|plain)/i.test(type)) {
            response.resume();
            failed(
              new Error(
                'Import a public HTML page, or upload the document instead.',
              ),
            );
            return;
          }
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > KNOWLEDGE_FILE_LIMIT)
              response.destroy(new Error('The web page is too large.'));
            else chunks.push(chunk);
          });
          response.on('error', failed);
          response.on('aborted', () =>
            failed(new Error('The website response was interrupted.')),
          );
          response.on('end', () =>
            finish({
              body: Buffer.concat(chunks).toString('utf8'),
              type,
              url: url.href,
            }),
          );
        },
      );
      timer = setTimeout(
        () => req.destroy(new Error('The website took too long to respond.')),
        12000,
      );
      req.on('error', failed);
      req.end();
    }).catch((error) => fail(error.message));
    if (result.redirect) {
      current = result.redirect;
      continue;
    }
    const extracted = /html/i.test(result.type)
      ? extractWebText(result.body)
      : {
          title: new URL(result.url).hostname,
          text: validateText(result.body),
        };
    return { ...extracted, url: result.url };
  }
  fail('The website redirects too many times. Paste its text instead.');
}
