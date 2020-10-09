function runAllFormats(evt) {
  if (window.File && window.FileReader && window.FileList && window.Blob) {
    var files = evt.target.files // FileList object
    for (const f of files) {
      const fname = f.name
      var reader = new FileReader()
      reader.onload = (function(theFile) {
        return function(e) {
          var data = split_b_k_whatsapp(e.target.result)
          if (data.length === 0) {
            console.log('ERROR: bad format: ' + fname + ', ' + e.target.result)
          } else {
            for (const d of data.data) {
              if (!d.date) {
                console.log('ERROR: bad date' + fname)
              }
            }
          }
        }
      })(f)
      reader.readAsText(f)
    }
    console.log('Got to end')
  }
}
