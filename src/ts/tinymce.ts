/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import tinymce from 'tinymce/tinymce';
import { Editor } from 'tinymce/tinymce';
import { DateTime } from 'luxon';
import i18next from './i18n';
import type { DropzoneFile } from 'dropzone';
import 'tinymce/models/dom';
import 'tinymce/icons/default';
import 'tinymce/themes/silver';
// Note about tinymce css stuff: this page https://www.tiny.cloud/docs/tinymce/6/webpack-es6-npm/ just doesn't work as advertised
// so it's easier to simply copy/extract the css files to web/assets/tinymce_skins instead via the yarn-plugin-tinymce.js
import 'tinymce/plugins/accordion';
import 'tinymce/plugins/advlist';
import 'tinymce/plugins/anchor';
import 'tinymce/plugins/autolink';
import 'tinymce/plugins/autoresize';
import 'tinymce/plugins/autosave';
import 'tinymce/plugins/charmap';
import 'tinymce/plugins/code';
import 'tinymce/plugins/codesample';
import 'tinymce/plugins/emoticons';
import 'tinymce/plugins/fullscreen';
import 'tinymce/plugins/image';
import 'tinymce/plugins/insertdatetime';
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/media';
import 'tinymce/plugins/pagebreak';
import 'tinymce/plugins/preview';
import 'tinymce/plugins/save';
import 'tinymce/plugins/searchreplace';
import 'tinymce/plugins/table';
import 'tinymce/plugins/template';
import 'tinymce/plugins/visualblocks';
import 'tinymce/plugins/visualchars';
import '../js/tinymce-langs/ca_ES.js';
import '../js/tinymce-langs/cs_CZ.js';
import '../js/tinymce-langs/de_DE.js';
import '../js/tinymce-langs/el_GR.js';
import '../js/tinymce-langs/en_GB.js';
import '../js/tinymce-langs/en_US.js';
import '../js/tinymce-langs/es_ES.js';
import '../js/tinymce-langs/fi_FI.js';
import '../js/tinymce-langs/fr_FR.js';
import '../js/tinymce-langs/id_ID.js';
import '../js/tinymce-langs/it_IT.js';
import '../js/tinymce-langs/ja_JP.js';
import '../js/tinymce-langs/ko_KR.js';
import '../js/tinymce-langs/nl_BE.js';
import '../js/tinymce-langs/pl_PL.js';
import '../js/tinymce-langs/pt_BR.js';
import '../js/tinymce-langs/pt_PT.js';
import '../js/tinymce-langs/ru_RU.js';
import '../js/tinymce-langs/sk_SK.js';
import '../js/tinymce-langs/sl_SI.js';
import '../js/tinymce-langs/uz_UZ.js';
import '../js/tinymce-langs/zh_CN.js';
import '../js/tinymce-plugins/mention/plugin.js';
import { EntityType, Model } from './interfaces';
import { getEntity, reloadElements, escapeExtendedQuery, updateEntityBody, getNewIdFromPostRequest } from './misc';
import { Api } from './Apiv2.class';
import { isSortable } from './TableSorting.class';
import { MathJaxObject } from 'mathjax-full/js/components/startup';
declare const MathJax: MathJaxObject;

// AUTOSAVE
const doneTypingInterval = 7000;  // time in ms between end of typing and save

function getNow(): DateTime {
  const locale = document.getElementById('user-prefs').dataset.jslang;
  return DateTime.now().setLocale(locale);
}

function getDatetime(): string {
  const useIso = document.getElementById('user-prefs').dataset.isodate;
  if (useIso === '1') {
    const fullDatetime = getNow().toISO({ includeOffset: false });
    // now we remove the milliseconds from that string
    // 2021-04-23T18:57:28.633  ->  2021-04-23T18:57:28
    return fullDatetime.slice(0, -4);
  }
  return getNow().toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
}

// ctrl-shift-D will add the date in the tinymce editor
function addDatetimeOnCursor(): void {
  tinymce.activeEditor.execCommand('mceInsertContent', false, `${getDatetime()} `);
}

function isOverCharLimit(): boolean {
  const body = tinymce.get(0).getBody();
  const text = tinymce.trim(body.innerText || body.textContent);
  return text.length > 1000000;
}

// user finished typing, save work
function doneTyping(): void {
  if (isOverCharLimit()) {
    alert('Too many characters!!! Cannot save properly!!!');
    return;
  }
  updateEntityBody();
}

// Object to hold control data for selected image
const tinymceEditImage = {
  selected: false,
  uploadId: 0,
  filename: 'unknown.png',
  reset: function(): void {
    this.selected = false;
    this.uploadId = 0;
    this.filename = 'unknown.png';
  },
};

// see issue about adding an interface for this object: https://github.com/tinymce/tinymce/issues/7982
interface TinyMCEBlobInfo {
  blob(): Blob;
  name(): string;
}

/**
 * This function handles image uploads dropped in the editor or uploaded with the Image plugin
 */
const imagesUploadHandler = (blobInfo: TinyMCEBlobInfo) => new Promise((resolve, reject) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dropzoneEl = document.getElementById('elabftw-dropzone') as any;
  const dropZone = dropzoneEl.dropzone;
  // when a file is added to dropZone (and uploaded), hook into the "complete" event
  // and reload uploadsDiv so we can grab the image url to replace the blob in the editor
  dropZone.on('complete', () => {
    if (dropZone.getUploadingFiles().length === 0 && dropZone.getQueuedFiles().length === 0) {
      reloadElements(['uploadsDiv']).then(() => {
        resolve(document.getElementById('last-uploaded-link').dataset.url);
      });
    }
  });
  const entity = getEntity();
  // Edgecase for editing an image using tinymce ImageTools
  // Check if it was selected. This is set by an event hook below
  if (tinymceEditImage.selected === true) {
    // Note: confirm will trigger the SelectionChange event hook below again
    if (confirm(i18next.t('replace-edited-file'))) {
      const formData = new FormData();
      const newfilecontent = new File(
        [blobInfo.blob()],
        tinymceEditImage.filename,
        { lastModified: new Date().getTime(), type: blobInfo.blob().type },
      );
      formData.set('file', newfilecontent);
      // prevent the browser from redirecting us
      formData.set('extraParam', 'noRedirect');
      // because the upload id is set this will replace the file directly
      fetch(`api/v2/${entity.type}/${entity.id}/${Model.Upload}/${tinymceEditImage.uploadId}`, {
        method: 'POST',
        body: formData,
      }).then(resp => {
        const newId = getNewIdFromPostRequest(resp);
        // fetch info about the newly created upload
        const ApiC = new Api();
        return ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}/${newId}`);
      }).then(json => {
        resolve(`app/download.php?f=${json.long_name}&storage=${json.storage}`);
        // save here because using the old real_name will not return anything from the db (status is archived now)
        updateEntityBody();
        reloadElements(['uploadsDiv']);
      });
    } else {
      // Revert changes if confirm is cancelled
      // ToDo: several times undo, e.g. if user rotated twice 90° but does not confirm the change
      tinymce.activeEditor.undoManager.undo();
      reject('Action cancelled');
    }
  // If the blob has no filename, ask for one. (Firefox edgecase: Embedded image in Data URL)
  } else if (typeof blobInfo.name() === 'undefined') {
    const filename = prompt('Enter filename with extension e.g. .jpeg');
    if (typeof filename !== 'undefined' && filename !== null) {
      const file = new File([blobInfo.blob()], filename, { lastModified: new Date().getTime(), type: blobInfo.blob().type }) as DropzoneFile;
      dropZone.addFile(file);
    } else {
      // Just disregard the edit if the name prompt is cancelled
      tinymce.activeEditor.undoManager.undo();
      reject('Action cancelled');
    }
  } else {
    dropZone.addFile(blobInfo.blob());
  }
});

// options for tinymce to pass to tinymce.init()
export function getTinymceBaseConfig(page: string): object {
  let plugins = 'accordion advlist anchor autolink autoresize table searchreplace code fullscreen insertdatetime charmap lists save image media link pagebreak codesample template mention visualblocks visualchars emoticons preview';
  let toolbar1 = 'custom-save preview | undo redo | styles fontsize bold italic underline strikethrough | alignleft aligncenter alignright alignjustify | superscript subscript | bullist numlist outdent indent | forecolor backcolor | charmap emoticons adddate | codesample | link | sort-table';
  let removedMenuItems = 'newdocument, image, anchor';
  if (page === 'edit' || page === 'ucp') {
    plugins += ' autosave';
    // add Image button in toolbar
    toolbar1 = toolbar1.replace('link |', 'link image |');
    // let Image in menu
    removedMenuItems = 'newdocument, anchor';
  }
  const entity = getEntity();
  const ApiC = new Api();

  return {
    selector: '.mceditable',
    table_default_styles: {
      'min-width':'25%',
    },
    // The table width is changed when manipulating columns, the size of other columns is maintained.
    table_column_resizing: 'resizetable',
    browser_spellcheck: true,
    // location of the skin directory
    skin_url: '/assets/tinymce_skins',
    content_css: '/assets/tinymce_content.min.css',
    emoticons_database_url: 'assets/tinymce_emojis.js',
    // remove the "Upgrade" button
    promotion: false,
    autoresize_bottom_margin: 50,
    // autoresize plugin will disallow manually resizing, but setting resize to true will make the scrollbar disappear
    //resize: true,
    plugins: plugins,
    pagebreak_split_block: true,
    pagebreak_separator: '<div class="page-break"></div>',
    toolbar1: toolbar1,
    // this addresses CVE-2024-29881, it defaults to true in 7.0, so can be removed in tiny 7.0 TODO
    convert_unsafe_embeds: true,
    // disable automatic h1 when using #
    text_patterns: false,
    removed_menuitems: removedMenuItems,
    image_caption: true,
    images_reuse_filename: false, // if set to true the src url gets a date appended
    images_upload_credentials: true,
    images_upload_handler: imagesUploadHandler,
    // use undocumented callback function to asynchronously get the templates
    // see https://github.com/tinymce/tinymce/issues/5637#issuecomment-624982699
    templates: (callback): void => {
      ApiC.getJson(`${EntityType.Template}`).then(json => {
        const res = [];
        json.forEach(tpl => {
          // only display pinned templates
          if (tpl.is_pinned) {
            res.push({'title': tpl.title, 'description': '', 'content': tpl.body});
          }
        });
        callback(res);
      });
    },
    contextmenu: false,
    paste_data_images: Boolean(page === 'edit' || page === 'ucp'),
    // use the preprocessing function on paste event to fix the bgcolor attribute from libreoffice into proper background-color style
    paste_preprocess: function(plugin, args) {
      args.content = args.content.replaceAll('bgcolor="', 'style="background-color:');
    },
    // also add it to Filter.php in Attr.AllowedClasses
    codesample_languages: [
      {text: 'Bash', value: 'bash'},
      {text: 'C', value: 'c'},
      {text: 'C++', value: 'cpp'},
      {text: 'CSS', value: 'css'},
      {text: 'Diff', value: 'diff'},
      {text: 'Fortran', value: 'fortran'},
      {text: 'Go', value: 'go'},
      {text: 'Igor', value: 'igor'},
      {text: 'Java', value: 'java'},
      {text: 'JavaScript', value: 'javascript'},
      {text: 'Json', value: 'json'},
      {text: 'Julia', value: 'julia'},
      {text: 'Latex', value: 'latex'},
      {text: 'Lua', value: 'lua'},
      {text: 'Makefile', value: 'makefile'},
      {text: 'Matlab', value: 'matlab'},
      {text: 'Perl', value: 'perl'},
      {text: 'Python', value: 'python'},
      {text: 'R', value: 'r'},
      {text: 'Ruby', value: 'ruby'},
      {text: 'Rust', value: 'rust'},
      {text: 'SQL', value: 'sql'},
      {text: 'Tcl', value: 'tcl'},
      {text: 'VHDL', value: 'vhdl'},
      {text: 'YAML', value: 'yaml'},
    ],
    codesample_global_prismjs: true,
    language: document.getElementById('user-prefs').dataset.lang,
    charmap_append: [
      [0x2640, 'female sign'],
      [0x2642, 'male sign'],
      [0x25A1, 'white square'],
      [0x2702, 'black scissors'],
      [0x21BB, 'clockwise open circle arrow'],
    ],
    height: '500',
    mentions: {
      // use # for autocompletion
      delimiter: ['#'],
      // get the source from json with get request
      source: function(query: string, process: (data) => void): void {
        query = escapeExtendedQuery(query);
        if (query.length < 1) {
          return;
        }
        // grab experiments and items
        const expjson = ApiC.getJson(`${EntityType.Experiment}?limit=12&scope=3&fastq=${query}`);
        const itemjson = ApiC.getJson(`${EntityType.Item}?limit=12&scope=3&fastq=${query}`);
        // and merge them into one
        Promise.all([expjson, itemjson]).then(values => {
          process(values[0].concat(values[1]));
        });
      },
      insert: function(selected): string {
        if (selected.type === 'items') {
          ApiC.post(`${entity.type}/${entity.id}/items_links/${selected.id}`)
            .then(() => reloadElements(['linksDiv']));
        }
        if (selected.type === 'experiments' && (entity.type === EntityType.Experiment || entity.type === EntityType.Item)) {
          ApiC.post(`${entity.type}/${entity.id}/experiments_links/${selected.id}`)
            .then(() => reloadElements(['linksExpDiv']));
        }
        const category = selected.category_title ? `${selected.category_title} - `: '';
        return `<span><a href='${selected.page}?mode=view&id=${selected.id}'>${category}${selected.title}</a></span>`;
      },
    },
    mobile: {
      plugins: [ 'autolink', 'image', 'link', 'lists', 'save', 'table', 'mention' ],
    },
    // use a custom function for the save button in toolbar
    save_onsavecallback: (): Promise<void> => updateEntityBody(),
    // keyboard shortcut to insert today's date at cursor in editor
    setup: (editor: Editor): void => {
      // holds the timer setTimeout function
      let typingTimer;
      // use event SkinLoaded instead of init so we're sure skinNode is present
      editor.on('SkinLoaded', () => {
        // prevent skin.min.css from changing appearance of .mce-preview-body element
        const skinNode = document.querySelector('[rel=stylesheet][href$="/skin.min.css"]') as HTMLLinkElement;
        const skinCSS = skinNode.sheet;
        Array.from(skinCSS.cssRules).forEach((rule, index) => {
          if (rule instanceof CSSStyleRule) {
            const selectors = rule.selectorText.split(',');
            const modifiedSelectors = selectors.map((selector) => selector.trim() + ':not(.mce-preview-body *)').join(',');
            rule.selectorText = modifiedSelectors;
            skinCSS.deleteRule(index);
            skinCSS.insertRule(rule.cssText, index);
          }
        });
      });
      // Hook into the blur event - Finalize potential changes to images if user clicks outside of editor
      editor.on('blur', () => {
        // this will trigger the images_upload_handler event hook defined further above
        editor.uploadImages();
      });
      // Hook into the SelectionChange event - This is to make sure we reset our control variable correctly
      editor.on('SelectionChange', () => {
        // Check if the user has selected an image
        if (editor.selection.getNode().tagName === 'IMG') {
          tinymceEditImage.selected = true;
          // Save all the details needed for replacing upload
          // Then check for and get those details when you are handling file uploads
          const selectedImage = (editor.selection.getNode() as HTMLImageElement);
          const searchParams = new URL(selectedImage.src).searchParams;
          // Get all the uploads from that entity
          ApiC.getJson(`${entity.type}/${entity.id}/${Model.Upload}`).then(json => {
            // Now find the one corresponding to the image selected in the body
            const upload = json.find(upload => upload.long_name === searchParams.get('f'));
            if (!upload) {
              return;
            }
            // Get id and filename (real_name) from this
            // this allows us to know which corresponding upload is selected so we can replace it if needed (after a crop for instance)
            tinymceEditImage.uploadId = upload.id;
            tinymceEditImage.filename = upload.real_name;
          });
        } else if (tinymceEditImage.selected === true) {
          // delay reset a bit so that images_upload_handler gets called first and can finish
          setTimeout(() => {
            tinymceEditImage.reset();
          }, 50);
        }
      });
      // prevent tables width from being set to "auto" and cause pdf export issues (see #5601)
      editor.on('GetContent', (e) => {
        e.content = e.content.replace(/(<table[^>]*?)\sstyle="[^"]*?width\s*:\s*auto;?[^"]*?"([^>]*?>)/gi, '$1$2');
      });

      // floppy disk icon from COLLECTION: Zest Interface Icons LICENSE: MIT License AUTHOR: zest
      editor.ui.registry.addIcon('customSave', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4 5a1 1 0 0 1 1-1h2v3a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4h.172a1 1 0 0 1 .707.293l2.828 2.828a1 1 0 0 1 .293.707V19a1 1 0 0 1-1 1h-1v-7a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v7H5a1 1 0 0 1-1-1V5Zm4 15h8v-6H8v6Zm6-16H9v2h5V4ZM5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7.828a3 3 0 0 0-.879-2.12l-2.828-2.83A3 3 0 0 0 16.172 2H5Z" /></svg>'), // eslint-disable-line

      // add date+time button
      editor.ui.registry.addButton('adddate', {
        icon: 'insert-time',
        tooltip: 'Insert timestamp',
        onAction: function() {
          editor.insertContent(`${getDatetime()} `);
        },
      });
      editor.ui.registry.addButton('custom-save', {
        icon: 'customSave',
        tooltip: 'Save',
        onAction: function() {
          editor.execCommand('mceSave');
        },
      });
      // some shortcuts
      editor.addShortcut('ctrl+shift+d', 'add date/time at cursor', addDatetimeOnCursor);
      editor.addShortcut('ctrl+=', 'subscript', () => editor.execCommand('subscript'));
      editor.addShortcut('ctrl+shift+=', 'superscript', () => editor.execCommand('superscript'));

      // on edit page there is an autosave triggered
      if (page === 'edit' || page === 'ucp') {
        editor.on('keydown', () => clearTimeout(typingTimer));
        editor.on('keyup', () => {
          clearTimeout(typingTimer);
          typingTimer = setTimeout(doneTyping, doneTypingInterval);
        });
      }

      // sort down icon from COLLECTION: Dazzle Line Icons LICENSE: CC Attribution License AUTHOR: Dazzle UI
      editor.ui.registry.addIcon('sort-amount-down-alt', '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 12h8m-8-4h8m-8 8h8M6 7v10m0 0-3-3m3 3 3-3" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'), // eslint-disable-line
      // add toggle button for table sorting
      editor.ui.registry.addToggleButton('sort-table', {
        icon: 'sort-amount-down-alt',
        tooltip: 'sortable table',
        onAction: api => {
          const table = editor.selection.getNode().closest('table');
          if (table) {
            if (api.isActive()) {
              // unset sortable
              delete table.dataset.tableSort;
              api.setActive(false);
            } else {
              // show alert if table is not sortable
              if (!isSortable(table, true)) {
                editor.focus();
                return;
              }
              // set sortable
              table.dataset.tableSort = 'true';
              // here the top row could be reformatted automatically td -> th
              api.setActive(true);
            }
            editor.undoManager.add();
          }
          editor.focus();
        },
        onSetup: api => {
          // button is enabled only if table is selected
          // button is active (highlighted) only if table is set sortable
          api.setEnabled(false);

          const callback = event => {
            const table = event.element.closest('table');
            if (!table) {
              api.setEnabled(false);
              api.setActive(false);
              return;
            }

            // table is selected, enable button
            api.setEnabled(true);
            if (table.dataset.tableSort === 'true') {
              // table is set sortable, highlight button
              api.setActive(true);
              return;
            }
            api.setActive(false);
          };

          editor.on('NodeChange', callback);

          return () => {
            editor.off('NodeChange', callback);
          };
        },
      });
    },
    style_formats_merge: true,
    style_formats: [
      {
        title: 'Image Left',
        selector: 'img',
        styles: {
          'float': 'left',
          'margin': '0 10px 0 10px',
        },
      }, {
        title: 'Image Right',
        selector: 'img',
        styles: {
          'float': 'right',
          'margin': '0 0 10px 10px',
        },
      },
    ],
    toolbar_sticky: true,
    // render MathJax for TinyMCE preview
    init_instance_callback: (editor) => {
      editor.on('ExecCommand', (e) => {
        if (e.command == 'mcePreview') {
          // declaration as iFrame element required to avoid errors with getting srcdoc property
          const iframe = (document.querySelector('iframe.tox-dialog__iframe') as HTMLIFrameElement);
          if (iframe) {
            iframe.onload = () => {
              const tinyDiv = document.createElement('div');
              tinyDiv.setAttribute('class', 'mce-content-body mce-preview-body');
              iframe.contentDocument.body.childNodes.forEach((node) => {
                tinyDiv.append(node);
              });
              // iframe replaced with div element because MathJax otherwise doesn't render menus properly; see #5295
              iframe.replaceWith(tinyDiv);
              MathJax.typesetPromise();
            };
          }
        }
      });
    },
  };
}
