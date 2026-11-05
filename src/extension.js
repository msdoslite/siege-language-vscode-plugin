'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { Project, GLOB, LANGUAGE_IDS } = require('./project');
const { profiles } = require('./core/skrit');

const selector = Object.keys(LANGUAGE_IDS).map(language => ({ language }));
const symbolKind = { block: vscode.SymbolKind.Namespace, property: vscode.SymbolKind.Property, variable: vscode.SymbolKind.Variable, parameter: vscode.SymbolKind.Variable, function: vscode.SymbolKind.Function, event: vscode.SymbolKind.Event, trigger: vscode.SymbolKind.Event, state: vscode.SymbolKind.EnumMember, key: vscode.SymbolKind.Key, file: vscode.SymbolKind.File };
function range(doc, start, end) { return new vscode.Range(doc.positionAt(start), doc.positionAt(end)); }
function word(doc, position) { const r = doc.getWordRangeAtPosition(position, doc.languageId === 'siege-gas' ? /[A-Za-z0-9_*$.-]+/ : /[A-Za-z_][A-Za-z0-9_]*\$?/); return r ? { name: doc.getText(r), range: r } : null; }
function occurrence(result, offset) { return result.occurrences.find(o => o.start <= offset && offset <= o.end); }
function visible(result, offset) {
  if (!result.scopes) return result.symbols;
  let id = 0;
  for (let i = 1; i < result.scopes.length; i++) if (result.scopes[i].start <= offset && offset <= result.scopes[i].end) id = i;
  const chain = new Set(); for (let s = id; s >= 0; s = result.scopes[s].parent) chain.add(s);
  const seen = new Set();
  return result.symbols.filter(s => chain.has(s.scope ?? 0) && ((s.kind !== 'variable' && s.kind !== 'parameter') || s.start <= offset)).sort((a, b) => b.scope - a.scope).filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; });
}
function activate(context) {
  const project = new Project(vscode, context), subscribe = d => context.subscriptions.push(d);
  // Language-specific settings are resource scoped, including multi-root workspaces.
  const config = uri => vscode.workspace.getConfiguration('siege', uri);
  const safeDetail = async doc => project.detail(doc);
  const callSnippet = s => {
    if (s.kind !== 'function' || !s.parameters) return undefined;
    const snippet = new vscode.SnippetString().appendText(s.name + '(');
    s.parameters.forEach((p, i) => { if (i) snippet.appendText(', '); snippet.appendPlaceholder(p.name || p.type); });
    return snippet.appendText(')').appendTabstop(0);
  };
  subscribe(vscode.commands.registerCommand('siege.showOutput', () => project.output.show()));
  subscribe(vscode.commands.registerCommand('siege.reindex', () => project.scan()));
  const gameProfiles = [
    { label: 'DSLOA / Dungeon Siege', value: 'dsloa' },
    { label: 'Dungeon Siege II', value: 'ds2' },
    { label: 'Space Siege', value: 'space-siege' }
  ];
  const selectProfile = async (value, resource) => {
    const folders = vscode.workspace.workspaceFolders || [];
    const activeUri = resource || vscode.window.activeTextEditor?.document.uri;
    let folder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    // Without an editor identifying a root, let the user choose in multi-root workspaces.
    if (!folder && folders.length === 1) folder = folders[0];
    if (folders.length && !folder) {
      folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the folder whose Siege profile to change' });
      if (!folder) return;
    }
    const uri = folder?.uri || resource || vscode.window.activeTextEditor?.document.uri;
    const current = config(uri).get('profile', 'dsloa');
    const choice = value ? gameProfiles.find(p => p.value === value) : await vscode.window.showQuickPick(gameProfiles.map(p => ({ ...p, description: p.value === current ? 'Current profile' : undefined })), { title: 'Siege syntax profile' });
    if (!choice) return;
    await config(uri).update('profile', choice.value, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
  };
  subscribe(vscode.commands.registerCommand('siege.selectProfile', resource => selectProfile(undefined, resource)));
  for (const profile of gameProfiles) subscribe(vscode.commands.registerCommand('siege.profile.' + profile.value, resource => selectProfile(profile.value, resource)));
  subscribe(vscode.workspace.onDidOpenTextDocument(doc => { if (project.language(doc)) project.enqueue(doc.uri, true); }));
  subscribe(vscode.workspace.onDidChangeTextDocument(e => { if (e.contentChanges.length) project.edited(e.document); }));
  subscribe(vscode.workspace.onDidSaveTextDocument(doc => { if (project.language(doc)) project.enqueue(doc.uri, true); }));
  subscribe(vscode.workspace.onDidCloseTextDocument(doc => { project.details.delete(doc.uri.toString()); if (project.language(doc)) { if (vscode.workspace.getWorkspaceFolder(doc.uri)) project.enqueue(doc.uri); else project.remove(doc.uri); } }));
  subscribe(vscode.workspace.onDidChangeWorkspaceFolders(() => project.scan().catch(e => project.output.appendLine(e.stack))));
  subscribe(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('siege') || e.affectsConfiguration('files.exclude') || e.affectsConfiguration('search.exclude')) project.scan().catch(err => project.output.appendLine(err.stack)); }));
  const watcher = vscode.workspace.createFileSystemWatcher(GLOB); subscribe(watcher);
  subscribe(watcher.onDidCreate(uri => project.diskChanged(uri).catch(e => project.output.appendLine(e.message))));
  subscribe(watcher.onDidChange(uri => project.diskChanged(uri).catch(e => project.output.appendLine(e.message))));
  subscribe(watcher.onDidDelete(uri => project.deleted(uri)));
  subscribe(vscode.languages.registerCompletionItemProvider(selector, {
    async provideCompletionItems(doc, position, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return [];
      const offset = doc.offsetAt(position);
      if (r.tokens.some(t => t.type === 'comment' && t.start <= offset && offset < t.end)) return [];
      const language = project.language(doc), items = [], seen = new Set(), w = word(doc, position);
      const prefix = w ? doc.getText(new vscode.Range(w.range.start, position)).toLowerCase() : '';
      const add = (name, kind, detail, insert, documentation) => {
        if (prefix && !name.toLowerCase().startsWith(prefix)) return;
        if (seen.has(name) || items.length >= 250) return; seen.add(name);
        const item = new vscode.CompletionItem(name, kind); item.detail = detail; item.range = w?.range;
        if (insert) item.insertText = insert; if (documentation) item.documentation = new vscode.MarkdownString(documentation);
        items.push(item);
      };
      const link = r.links.find(l => l.start <= offset && offset <= l.end);
      if (link) {
        const typed = doc.getText(range(doc, link.start, offset)), base = vscode.Uri.joinPath(doc.uri, '..').path;
        for (const { uri, language: targetLanguage } of project.results.values()) {
          if (link.kind === 'include' && targetLanguage !== 'skrit') continue;
          const relative = path.posix.relative(base, uri.path);
          if (relative.startsWith(typed) && items.length < 250) {
            const item = new vscode.CompletionItem(relative, vscode.CompletionItemKind.File);
            item.range = range(doc, link.start, link.end); item.detail = 'Local workspace resource'; items.push(item);
          }
        }
        return new vscode.CompletionList(items, items.length >= 250);
      }
      const region = r.regions.find(s => s.start <= offset && offset <= s.end);
      let local = r;
      if (region?.language === 'skrit') local = (await project.client.analyze(doc.getText().slice(region.start, region.end), 'skrit', project.options(doc.uri), true)).result;
      const skrit = language === 'skrit' || region?.language === 'skrit';
      if (skrit) {
        for (const s of visible(local, region ? offset - region.start : offset)) add(s.name, s.kind === 'function' ? vscode.CompletionItemKind.Function : s.kind === 'state' ? vscode.CompletionItemKind.EnumMember : vscode.CompletionItemKind.Variable, s.signature || s.detail, callSnippet(s));
        const keys = (profiles[project.options(doc.uri).profile] || profiles.dsloa).keywords;
        for (const name of Object.keys(keys)) if (!['include', 'option', 'only'].includes(name)) add(name, vscode.CompletionItemKind.Keyword, 'Skrit keyword');
        const line = doc.lineAt(position.line).text.slice(0, position.character);
        if (/^[ \t]*#/.test(line)) {
          for (const [name, body] of [['include', 'include "${1:path.skrit}"'], ['option', 'option ${1|+explicit_states,-explicit_states,+force_float_constants,-force_float_constants|}'], ['only', 'only(${1:game}) [[\n\t$0\n]]']]) add(name, vscode.CompletionItemKind.Snippet, 'Skrit preprocessor', new vscode.SnippetString(body));
        }
      } else if (language === 'gas') {
        const at = r.symbols.find(s => s.kind === 'property' && s.valueStart <= offset && offset <= s.valueEnd);
        if (at?.type === 'b') { add('true', vscode.CompletionItemKind.Value, 'Boolean'); add('false', vscode.CompletionItemKind.Value, 'Boolean'); }
        const prefixDocs = { b: 'Boolean: true / false', d: 'Double', f: 'Float', i: 'Integer', p: 'SiegePos: XYZ + node GUID', q: 'Quaternion: four components', s: 'String', v: 'Vector: scalar or three components', x: 'Integer (decimal or hexadecimal)' };
        if (!at) for (const [p, docstring] of Object.entries(prefixDocs)) add(p, vscode.CompletionItemKind.TypeParameter, docstring, new vscode.SnippetString(`${p} \${1:name} = \${2:value};`));
      } else if (language === 'flick') for (const name of ['entry', 'thread', 'role', 'required', 'external', 'critical', 'bool', 'int', 'float', 'string', 'event', 'effect', 'point', 'if', 'else', 'goto', 'run', 'branch', 'jump', 'wait', 'duration', 'until']) add(name, vscode.CompletionItemKind.Keyword, 'Flick keyword');
      else if (language === 'nnk') { add('TREE', vscode.CompletionItemKind.Snippet, 'Naming Key tree entry', new vscode.SnippetString('TREE = ${1|A,B,K,M,S,T|}_${2:KEY}, ${3:directory}, ${4:description}')); add('CANIMCLASS', vscode.CompletionItemKind.Keyword, 'Tool metadata; ignored by examined native NNK readers'); }
      for (const [name, matches] of project.names) {
        const match = matches.find(m => m.language === (skrit ? 'skrit' : language)); if (!match) continue;
        if (skrit && match.symbol.scope !== undefined && match.symbol.scope !== 0) continue;
        add(name, match.symbol.kind === 'function' ? vscode.CompletionItemKind.Function : match.symbol.kind === 'block' ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Property, match.symbol.signature || match.symbol.detail, callSnippet(match.symbol), `Found in workspace: ${vscode.workspace.asRelativePath(vscode.Uri.parse(match.uri))}.`);
      }
      return new vscode.CompletionList(items, items.length >= 250);
    }
  }, '.', ':', '#', '$'));
  subscribe(vscode.languages.registerHoverProvider(selector, {
    async provideHover(doc, position, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return;
      const offset = doc.offsetAt(position), o = occurrence(r, offset), s = o?.symbolStart !== undefined ? r.symbols.find(s => s.start === o.symbolStart) : r.symbols.find(s => s.selectionStart <= offset && offset <= s.selectionEnd);
      if (s) { const md = new vscode.MarkdownString(); md.appendCodeblock(s.signature || `${s.type || s.kind} ${s.name}`, project.language(doc) === 'skrit' ? 'siege-skrit' : 'text'); if (s.detail) md.appendText('\n' + s.detail); return new vscode.Hover(md, range(doc, o?.start ?? s.selectionStart, o?.end ?? s.selectionEnd)); }
      const t = r.tokens.find(t => t.start <= offset && offset < t.end);
      const notes = { '&&': 'DSLOA evaluates both operands; DS2 / Space Siege use their own short-circuit profile.', '||': 'DSLOA evaluates both operands; DS2 / Space Siege use their own short-circuit profile.', '**': 'Power. Skrit binds unary minus more tightly than power.', '@=': 'Space Siege source metadata marker. The packing stage drops this marker.', '#only': 'A single condition token; the first genuine ]] closes the body.' };
      if (t && notes[t.value]) return new vscode.Hover(notes[t.value], range(doc, t.start, t.end));
    }
  }));
  subscribe(vscode.languages.registerDefinitionProvider(selector, {
    async provideDefinition(doc, position, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return;
      const o = occurrence(r, doc.offsetAt(position));
      if (o?.symbolStart !== undefined) { const s = r.symbols.find(s => s.start === o.symbolStart); if (s) return new vscode.Location(doc.uri, range(doc, s.selectionStart, s.selectionEnd)); }
      const w = word(doc, position); if (!w) return;
      return (project.names.get(w.name) || []).filter(m => m.language === project.language(doc)).slice(0, 30).map(m => new vscode.Location(vscode.Uri.parse(m.uri), new vscode.Range(m.symbol.location.line, m.symbol.location.character, m.symbol.location.line, m.symbol.location.character + m.symbol.name.length)));
    }
  }));
  subscribe(vscode.languages.registerReferenceProvider(selector, {
    async provideReferences(doc, position, options, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return [];
      const o = occurrence(r, doc.offsetAt(position)); if (o?.symbolStart === undefined) return [];
      return r.occurrences.filter(x => x.symbolStart === o.symbolStart && (options.includeDeclaration || !x.declaration)).map(x => new vscode.Location(doc.uri, range(doc, x.start, x.end)));
    }
  }));
  subscribe(vscode.languages.registerRenameProvider([{ language: 'siege-skrit' }], {
    async prepareRename(doc, position) { const r = await safeDetail(doc), o = r && occurrence(r, doc.offsetAt(position)); if (o?.symbolStart === undefined) throw Error('Only resolved symbols in this source can be renamed.'); return { range: range(doc, o.start, o.end), placeholder: o.name }; },
    async provideRenameEdits(doc, position, newName) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*\$$/.test(newName)) throw Error('A Skrit user name must end in $.');
      const r = await safeDetail(doc), o = r && occurrence(r, doc.offsetAt(position)); if (o?.symbolStart === undefined) return;
      const symbol = r.symbols.find(s => s.start === o.symbolStart);
      if (r.symbols.some(s => s.scope === symbol.scope && s.name === newName && s.start !== symbol.start)) throw Error('That name already exists in the same scope.');
      const edit = new vscode.WorkspaceEdit(); for (const x of r.occurrences) if (x.symbolStart === o.symbolStart) edit.replace(doc.uri, range(doc, x.start, x.end), newName); return edit;
    }
  }));
  subscribe(vscode.languages.registerSignatureHelpProvider([{ language: 'siege-skrit' }], {
    async provideSignatureHelp(doc, position, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return;
      const ts = r.tokens.filter(t => t.end <= doc.offsetAt(position) && t.type !== 'comment'); let depth = 0, commas = 0;
      for (let i = ts.length - 1; i >= 0; i--) {
        if (ts[i].value === ')') depth++;
        if (ts[i].value === '(') { if (depth) { depth--; continue; } const name = ts[i - 1]?.value, s = visible(r, doc.offsetAt(position)).find(s => s.name === name && s.parameters) || project.names.get(name)?.find(m => m.language === 'skrit' && m.symbol.parameters)?.symbol; if (!s) return; const help = new vscode.SignatureHelp(), sig = new vscode.SignatureInformation(s.signature || s.name); sig.parameters = s.parameters.map(p => new vscode.ParameterInformation(p.type + ' ' + p.name)); help.signatures = [sig]; help.activeSignature = 0; help.activeParameter = Math.min(commas, Math.max(0, sig.parameters.length - 1)); return help; }
        if (depth === 0 && ts[i].value === ',') commas++;
        if (depth === 0 && [';', '{', '}'].includes(ts[i].value)) return;
      }
    }
  }, '(', ','));
  subscribe(vscode.languages.registerDocumentSymbolProvider(selector, {
    async provideDocumentSymbols(doc, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return [];
      const roots = [], stack = [];
      for (const s of [...r.symbols].sort((a, b) => a.start - b.start || b.end - a.end)) {
        const item = new vscode.DocumentSymbol(s.name, s.detail || '', symbolKind[s.kind] || vscode.SymbolKind.Variable, range(doc, s.start, Math.max(s.end, s.selectionEnd)), range(doc, s.selectionStart, s.selectionEnd));
        while (stack.length && stack[stack.length - 1].end < s.end) stack.pop();
        if (stack.length && s.start >= stack[stack.length - 1].start) stack[stack.length - 1].item.children.push(item); else roots.push(item);
        if (s.end > s.selectionEnd) stack.push({ start: s.start, end: s.end, item });
      }
      return roots;
    }
  }));
  subscribe(vscode.languages.registerWorkspaceSymbolProvider({
    provideWorkspaceSymbols(query, token) { const result = [], q = query.toLowerCase(); for (const [name, matches] of project.names) { if (token.isCancellationRequested) break; if (!name.toLowerCase().includes(q)) continue; for (const m of matches) { const p = m.symbol.location; result.push(new vscode.SymbolInformation(name, symbolKind[m.symbol.kind] || vscode.SymbolKind.Variable, m.symbol.container || '', new vscode.Location(vscode.Uri.parse(m.uri), new vscode.Range(p.line, p.character, p.line, p.character + name.length)))); if (result.length >= 500) return result; } } return result; }
  }));
  subscribe(vscode.languages.registerFoldingRangeProvider(selector, {
    async provideFoldingRanges(doc, _, token) { const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return []; return r.folds.map(f => [doc.positionAt(f.start).line, doc.positionAt(f.end).line]).filter(([a, b]) => b > a).map(([a, b]) => new vscode.FoldingRange(a, b)); }
  }));
  subscribe(vscode.languages.registerCodeActionsProvider(selector, {
    async provideCodeActions(doc, selection, context, token) { const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return []; return r.diagnostics.filter(d => d.fix && range(doc, d.start, d.end).intersection(selection)).map(d => { const action = new vscode.CodeAction(d.code === 'editor.gas.header.separator' ? 'Use canonical comma separator' : d.code === 'editor.gas.header.tail' ? 'Remove unexpected header text' : d.fix.text === ';' ? 'Insert missing semicolon' : d.fix.text === '$' ? 'Add user-name suffix $' : 'Repair delimiter', vscode.CodeActionKind.QuickFix); action.edit = new vscode.WorkspaceEdit(); action.edit.replace(doc.uri, range(doc, d.fix.start, d.fix.end), d.fix.text); action.diagnostics = context.diagnostics.filter(x => x.code === d.code); action.isPreferred = true; return action; }); }
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
  subscribe(vscode.languages.registerDocumentLinkProvider(selector, {
    async provideDocumentLinks(doc, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return [];
      const links = [];
      for (const l of r.links) {
        const target = l.target.replace(/\\/g, '/'); if (/^[a-z]+:|^\/|^K_/i.test(target)) continue;
        const candidate = vscode.Uri.joinPath(doc.uri, '..', target);
        try { await vscode.workspace.fs.stat(candidate); const link = new vscode.DocumentLink(range(doc, l.start, l.end), candidate); link.tooltip = 'Open local resource'; links.push(link); } catch { /* Virtual Tank resources need not exist on the local filesystem. */ }
      }
      return links;
    }
  }));

  const legendTypes = ['namespace', 'type', 'function', 'variable', 'parameter', 'property', 'keyword', 'string', 'number', 'operator', 'comment', 'enumMember'];
  const legend = new vscode.SemanticTokensLegend(legendTypes, ['declaration']);
  subscribe(vscode.languages.registerDocumentSemanticTokensProvider(selector, {
    async provideDocumentSemanticTokens(doc, token) {
      const r = await safeDetail(doc); if (!r || token.isCancellationRequested) return null;
      const builder = new vscode.SemanticTokensBuilder(legend), embeddedOnly = project.language(doc) === 'gas';
      const bindings = new Map(r.occurrences.map(o => [o.start, o])), symbols = new Map(r.symbols.map(s => [s.start, s]));
      let previousEnd = -1;
      for (const t of r.tokens.filter(t => !embeddedOnly || t.embedded).sort((a, b) => a.start - b.start)) {
        if (t.start < previousEnd || t.end <= t.start) continue;
        let type = { header: 'namespace', type: 'type', property: 'property', keyword: 'keyword', directive: 'keyword', string: 'string', number: 'number', operator: 'operator', comment: 'comment' }[t.type];
        const binding = bindings.get(t.start), s = symbols.get(binding?.symbolStart);
        if (t.type === 'identifier') type = s ? ({ function: 'function', event: 'function', trigger: 'function', parameter: 'parameter', state: 'enumMember' }[s.kind] || 'variable') : undefined;
        if (!type) continue;
        let pos = doc.positionAt(t.start), end = doc.positionAt(t.end);
        for (let line = pos.line; line <= end.line; line++) {
          const start = line === pos.line ? pos.character : 0, stop = line === end.line ? end.character : doc.lineAt(line).text.length;
          if (stop > start) builder.push(line, start, stop - start, legendTypes.indexOf(type), binding?.declaration ? 1 : 0);
        }
        previousEnd = t.end;
      }
      return builder.build();
    }
  }, legend));

  project.scan().catch(e => project.output.appendLine(e.stack));
  // Read-only inspection also supports the dependency-free Extension Host tests.
  return { project, whenIdle: async () => { while (project.scanning || project.active || project.queue.size || project.timers.size) await new Promise(resolve => setTimeout(resolve, 20)); } };
}
module.exports = { activate };
