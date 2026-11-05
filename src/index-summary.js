'use strict';
// Diagnostics are never sampled. Workspace symbol candidates omit repeated data
// fields and numeric map IDs; detailed per-document symbols remain complete.
function summarize(full, language) {
  const symbols=[],seen=new Set();let omitted=0;
  for(const s of full.symbols){
    if(s.scope!==undefined&&s.scope!==0){omitted++;continue;}
    if(language==='gas'){
      if(s.name==='*'||/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(s.name)){omitted++;continue;}
      const key=s.kind==='block'&&!s.container?'root:'+s.start:s.kind+':'+s.name+':'+(s.type||'');
      if(seen.has(key)){omitted++;continue;}seen.add(key);
    }
    const {value,valueStart,valueEnd,mode,...symbol}=s;symbols.push(symbol);
  }
  return {diagnostics:full.diagnostics,symbols,indexOmitted:omitted,syntaxAccepted:full.syntaxAccepted};
}
module.exports={summarize};
