// Synthetic OOXML only. No uploaded resumes or personal records belong in tests.
const {createRequire}=require('node:module');
const Zip=createRequire(require.resolve('mammoth'))('jszip');
module.exports=async()=>{
 const zip=new Zip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml"><w:body>
 <w:p><w:r><w:t>Jamie Rivera</w:t></w:r></w:p>
 <w:p><w:r><w:t>QA Analyst</w:t></w:r></w:p>
 <w:p><w:r><w:t xml:space="preserve">Owned risk •documentation and business</w:t><w:noBreakHyphen/><w:t>aligned testing controls.</w:t></w:r></w:p>
 <w:p><w:r><w:pict><v:shape id="text-box"><v:textbox><w:txbxContent><w:p><w:r><w:t>Documented regression coverage across billing systems.</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>
 <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Manual regression testing</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
 <w:sectPr/></w:body></w:document>`);
 return zip.generateAsync({type:'nodebuffer'});
};
