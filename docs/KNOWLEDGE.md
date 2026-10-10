# Enriching your twin's knowledge

Open `/studio`, sign in, and choose **Knowledge**. This is where you add the
information your twin can use in visitor conversations.
Choose **Voice → Robosa AI** to use this library. A separately configured
Open-LLM-VTuber runtime manages its own answers and does not receive these sources.

1. Upload a searchable PDF, DOCX, TXT, Markdown, or HTML document, or paste text
   into **Source text**.
2. Give it a descriptive title and choose a source type.
3. Review the extracted text. Remove private details and correct extraction
   errors before allowing visitors to use it.
4. Choose **Save draft** to keep reviewing, or **Save and approve for answers**.
5. Open your public twin and ask a question. Expand **Sources** below a reply
   to see the material it used.

Imports are previews. They do not save or approve anything automatically.
Source saves are independent of the profile's **Save changes** button.
Sources and their approval state survive signing out and restarting the server.
**Review** edits a source; **Exclude from answers** returns it to draft;
the remove button deletes it. Only approved, unexpired sources inform answers.

## What to add

| Material                | Source type             | Useful details                                                                                                     |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Resume / CV             | Resume / CV             | Roles, dates, responsibilities, skills, education, and verified achievements                                       |
| LinkedIn profile        | LinkedIn / biography    | Export the profile PDF or paste its text; preserve dates and role context                                          |
| Project history         | Project background      | Motivation, audience, your role, development steps, technology, decisions, challenges, results, and current status |
| Blog / personal writing | Writing / blog          | Full article, title, publication date, and original link; clarify which opinions are yours                         |
| Portfolio               | Portfolio / case study  | Your contribution, work samples, measurable outcomes, and supporting links                                         |
| Schedule                | Availability / schedule | Timezone, preferred meeting windows, restrictions, and a required expiry date                                      |

Public blog and portfolio HTML pages can also be previewed with **Import page**.
LinkedIn pages requiring sign-in are not imported; use a profile export or pasted
text. There is no automatic LinkedIn synchronization or live calendar connection.
Schedule notes are dated snapshots, and meeting requests still require owner
acceptance. Availability expires at the end of the selected date in UTC.

## Answering “how was Robosa built?”

A short project tagline cannot support a detailed creation story. Add one source
called **Robosa — creation and current status**, using your actual facts:

```text
Project: Robosa.me
Last updated: <date>

Purpose and audience:
Explain the problem and the people you built it for.

My role and timeline:
Describe your contribution and the actual development sequence.

How it was built:
Describe the components, technologies, and how they work together.

Decisions and challenges:
Explain the choices, tradeoffs, problems, and solutions you experienced.

Results and current status:
Separate what works today from experiments and future plans.
```

Fill this in before approving it. Headings and example placeholders are not
facts. Keep **Quick profile knowledge → Projects** for actual project names and
short summaries, one per line. “Robosa origin,” “Robosa technology,” and “Robosa
challenges” belong inside this background source rather than becoming separate
projects. Remove any older placeholder summaries from your profile.

Try “Tell me about Robosa,” then “How was this built?” The server uses recent
user turns to recover the topic and retrieves relevant approved passages.
Previous assistant answers do not become approved knowledge.

## Search and contextual answers

With `OPENAI_API_KEY` configured on the server, approving a source builds a
semantic index using [OpenAI embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create).
Search combines matching words with meaning-based similarity. The configured
Responses model receives selected passages and recent conversation context to
compose an answer with validated source IDs using
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
Drafts and expired sources are excluded from retrieval. Edited sources are
reindexed when you approve them again. No API keys are sent to the browser.

`ROBOSA_CHAT_PROVIDER=openai` requires OpenAI answers. Errors are displayed instead
of substituting basic profile responses. Your `.env` can use:

```dotenv
OPENAI_API_KEY=replace-with-your-key
ROBOSA_OPENAI_MODEL=gpt-5-nano
ROBOSA_CHAT_PROVIDER=openai
```

Restart the development server after changing `.env`. In **Voice → Robosa AI**,
use **Test OpenAI connection**. This test sends only synthetic text, never uploaded
documents. Replies show their actual provider and model below the message.

In the default `auto` provider mode, without a key or if a provider request fails,
the twin uses matching approved excerpts and profile answers and labels that
fallback. Set `local` for excerpts only. Excerpt mode can retrieve details but does
not synthesize them into a new explanation. The studio shows **Text search ready**
or **Contextual search ready** for approved sources. If you configure a key after
adding sources, review and approve them again to build their semantic indexes.
Indexing failures are reported on source cards so you can resolve the cause and
retry approval. Introduction and career-history questions retrieve resume and
biography evidence, including common misspellings of “career.”

Grounding and citations improve traceability; they do not guarantee that every
generated claim is correct. Review important answers against the cited text.

## Storage and limits

- Uploaded files: up to 8 MB; PDFs: up to 100 pages. Scanned images need OCR
  elsewhere, then a searchable PDF or pasted text.
- Each source: up to 100,000 characters; library: up to 40 sources and two
  million characters per owner.
- Extracted text, metadata, and server-only search indexes are persisted in
  `.robosa-data/database.json` (or `ROBOSA_DATA_DIR`). Original knowledge document
  bytes are processed for extraction and are not retained.
- Approved passages can appear in public answers and citation excerpts. With
  the AI provider configured, approved text is sent to that provider for indexing
  and selected context for answers. Keep sensitive material out of approved sources.
- Deleting a source removes it from future retrieval. It does not erase earlier
  conversation text or material already shared with visitors.

The library currently uses the local, single-process JSON database. Automatic
source refresh, OCR, calendar OAuth, and a production vector database remain
future work.
