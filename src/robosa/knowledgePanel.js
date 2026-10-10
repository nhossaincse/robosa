import { projectsToText } from './profileStore.js';

export function renderKnowledgePanel(state, { escapeHtml, icon }) {
  const draft = state.knowledgeDraft;
  const kinds = {
    resume: 'Resume / CV',
    profile: 'LinkedIn / biography',
    project: 'Project background',
    writing: 'Writing / blog',
    portfolio: 'Portfolio / case study',
    availability: 'Availability / schedule',
    other: 'Other knowledge',
  };
  const approved = state.knowledgeSources.filter(
    (source) =>
      source.status === 'approved' &&
      (!source.validUntil ||
        Date.parse(`${source.validUntil}T23:59:59.999Z`) >= Date.now()),
  ).length;
  return `
    <div class="editor-heading">
      <span class="eyebrow">Knowledge</span>
      <h1>Give your twin the full story.</h1>
      <p>Add your resume, project background, writing, and portfolio. Review each source, then approve what your twin can share.</p>
    </div>
    <div class="knowledge-overview">
      <div><strong>${approved}</strong><span>sources approved for answers</span></div>
      <p>${state.reasoningEnabled ? 'Contextual AI connects relevant passages and cites its sources.' : 'Source search is active. Enable the server’s AI provider for synthesized, contextual answers.'}</p>
    </div>
    ${state.knowledgeError ? `<p class="knowledge-error" role="alert">${escapeHtml(state.knowledgeError)}</p>` : ''}
    <section class="editor-panel" aria-labelledby="knowledge-heading">
      <div class="panel-heading">
        <h2 id="knowledge-heading">${draft.id ? 'Review source' : 'Add a source'}</h2>
        <p>Sources are saved to your account. Drafts never appear in visitor answers.${state.reasoningEnabled ? ' Approved text is sent to your configured AI provider for search and answers.' : ''}</p>
      </div>
      <div class="knowledge-import-actions">
        <button class="secondary-button" type="button" data-action="import-knowledge-file" ${state.knowledgeBusy ? 'disabled' : ''}>${icon('upload')} Upload document</button>
        <span>PDF, DOCX, TXT, Markdown, HTML · Up to 8 MB</span>
        <input type="file" class="media-input" id="knowledge-file" accept=".pdf,.docx,.txt,.md,.html,.htm" aria-label="Upload a knowledge document" />
      </div>
      <div class="form-grid knowledge-source-editor">
        <label class="form-field"><span class="field-label">Source title</span><input data-knowledge-field="title" maxlength="160" value="${escapeHtml(draft.title)}" placeholder="My resume, or How I built Robosa" /></label>
        <label class="form-field"><span class="field-label">Source type</span><select data-knowledge-field="kind">${Object.entries(
          kinds,
        )
          .map(
            ([value, label]) =>
              `<option value="${value}" ${draft.kind === value ? 'selected' : ''}>${label}</option>`,
          )
          .join('')}</select></label>
        <label class="form-field full"><span class="field-label">Original link (optional)</span><div class="knowledge-url-row"><input data-knowledge-field="url" type="url" value="${escapeHtml(draft.url)}" placeholder="https://your-site.com/blog/project-story" /><button class="secondary-button" type="button" data-action="import-knowledge-url" ${state.knowledgeBusy ? 'disabled' : ''}>Import page</button></div><span class="field-hint">For LinkedIn, upload your exported profile PDF or paste the text below. Public blog and portfolio pages can be imported by link.</span></label>
        <label class="form-field full"><span class="field-label">Source text</span><textarea data-knowledge-field="text" class="knowledge-text" maxlength="100000" placeholder="Paste real details here: your experience, project motivation, how it was built, technologies, decisions, results, and lessons. Include the project name so follow-up questions have context.">${escapeHtml(draft.text)}</textarea><span class="field-hint">Review imported text and remove details you do not want your twin to share. Up to 100,000 characters per source.</span></label>
        <label class="form-field full"><span class="field-label">Valid through (required for availability)</span><input data-knowledge-field="validUntil" type="date" value="${escapeHtml(draft.validUntil)}" /><span class="field-hint">Include your timezone in schedule text. Sources expire at the end of this date in UTC. Schedule notes are snapshots; a live calendar is not connected.</span></label>
      </div>
      <p class="knowledge-import-status" role="status">${escapeHtml(state.knowledgeBusy)}</p>
      <div class="knowledge-editor-actions">
        <button class="secondary-button" type="button" data-action="save-knowledge-draft" ${state.knowledgeBusy ? 'disabled' : ''}>Save draft</button>
        <button class="primary-button" type="button" data-action="approve-knowledge" ${state.knowledgeBusy ? 'disabled' : ''}>${icon('check')} Save and approve for answers</button>
        ${draft.id ? '<button class="quiet-button" type="button" data-action="new-knowledge">Add another source</button>' : ''}
      </div>
    </section>
    <section class="editor-panel knowledge-library" aria-labelledby="knowledge-library-heading">
      <div class="panel-heading"><h2 id="knowledge-library-heading">Your source library</h2><p>Approved sources inform answers. Edit, exclude, or remove them anytime.</p></div>
      ${
        state.knowledgeSources.length
          ? state.knowledgeSources
              .map((source) => {
                const expired =
                  source.validUntil &&
                  Date.parse(`${source.validUntil}T23:59:59.999Z`) < Date.now();
                return `<article class="knowledge-card"><div class="knowledge-card-heading"><div><span class="section-kicker">${escapeHtml(kinds[source.kind] || 'Knowledge')}</span><h3>${escapeHtml(source.title)}</h3></div><span class="knowledge-status ${source.status === 'approved' && !expired ? 'approved' : ''}">${expired ? 'Expired' : source.status === 'approved' ? 'Approved' : 'Draft'}</span></div><p>${escapeHtml(source.text.slice(0, 200))}${source.text.length > 200 ? '…' : ''}</p>${source.indexError ? `<p class="knowledge-index-error">Contextual indexing: ${escapeHtml(source.indexError.message)} Review and approve again to retry.</p>` : ''}<div class="knowledge-card-footer"><span>${source.text.length.toLocaleString()} characters${source.status === 'approved' ? (source.searchMode === 'semantic' ? ' · Contextual search ready' : ' · Text search ready') : ''}${source.validUntil ? ` · Valid through ${escapeHtml(source.validUntil)}` : ''}</span><div><button class="quiet-button" type="button" data-knowledge-edit="${source.id}">${icon('edit')} Review</button>${source.status === 'approved' ? `<button class="quiet-button" type="button" data-knowledge-exclude="${source.id}">Exclude from answers</button>` : ''}<button class="quiet-button" type="button" data-knowledge-remove="${source.id}" aria-label="Remove ${escapeHtml(source.title)}">${icon('delete')}</button></div></div></article>`;
              })
              .join('')
          : '<div class="knowledge-empty">Start with your resume and a project story. Add blog posts, case studies, and LinkedIn profile text as separate sources.</div>'
      }
    </section>
    <section class="editor-panel knowledge-profile-fields">
      <div class="panel-heading"><h2>Quick profile knowledge</h2><p>List actual projects here, one per line. Put project history and detailed notes in the source library above.</p></div>
      <div class="form-grid">
        <label class="form-field full">
          <span class="field-label">Projects</span>
          <textarea name="projects" data-profile-field="projects" placeholder="Project name: What it is">${escapeHtml(projectsToText(state.profile.projects))}</textarea>
          <span class="field-hint">Format: project name, colon, then a short description.</span>
        </label>
        <label class="form-field full">
          <span class="field-label">Facts and working preferences</span>
          <textarea name="facts" data-profile-field="facts" placeholder="One approved fact per line">${escapeHtml(state.profile.facts.join('\n'))}</textarea>
        </label>
      </div>
    </section>`;
}
