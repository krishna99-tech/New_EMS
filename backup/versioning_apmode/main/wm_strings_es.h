/**
 * wm_strings_es.h
 * spanish strings for
 * WiFiManager, a library for the ESP8266/Arduino platform
 * for configuration of WiFi credentials using a Captive Portal
 *
 * @author Creator tzapu
 * @author tablatronix
 * @version 0.0.0
 * @license MIT
 */

#ifndef _WM_STRINGS_ES_H_
#define _WM_STRINGS_ES_H_


#ifndef WIFI_MANAGER_OVERRIDE_STRINGS
// !!! ABOVE WILL NOT WORK if you define in your sketch, must be build flag, if anyone one knows how to order includes to be able to do this it would be neat.. I have seen it done..

// strings files must include a consts file!
#include "wm_consts_en.h" // include constants, tokens, routes

const char WM_LANGUAGE[] PROGMEM = "es-ES"; // i18n lang code

const char HTTP_HEAD_START[]       PROGMEM = "<!DOCTYPE html>"
"<html lang='es'><head>"
"<meta name='format-detection' content='telephone=no'>"
"<meta charset='UTF-8'>"
"<meta  name='viewport' content='width=device-width,initial-scale=1,user-scalable=no'/>"
"<meta name='theme-color' content='#1fa3ec'>"
"<title>{v}</title>";

const char HTTP_SCRIPT[]           PROGMEM = "<script>function c(l){"
"document.getElementById('s').value=l.getAttribute('data-ssid')||l.innerText||l.textContent;"
"p = l.nextElementSibling.classList.contains('l');"
"document.getElementById('p').disabled = !p;"
"if(p)document.getElementById('p').focus();};"
"function f() {var x = document.getElementById('p');x.type==='password'?x.type='text':x.type='password';}"
"</script>"; // @todo add button states, disable on click , show ack , spinner etc

const char HTTP_HEAD_END[]         PROGMEM = "</head><body class='{c}'><div class='shell'><div class='wrap'>"; // {c} = _bodyclass
// example of embedded logo, base64 encoded inline, No styling here
// const char HTTP_ROOT_MAIN[]        PROGMEM = "<img title=' alt=' src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAADQElEQVRoQ+2YjW0VQQyE7Q6gAkgFkAogFUAqgFQAVACpAKiAUAFQAaECQgWECggVGH1PPrRvn3dv9/YkFOksoUhhfzwz9ngvKrc89JbnLxuA/63gpsCmwCADWwkNEji8fVNgotDM7osI/x777x5l9F6JyB8R4eeVql4P0y8yNsjM7KGIPBORp558T04A+CwiH1UVUItiUQmZ2XMReSEiAFgjAPBeVS96D+sCYGaUx4cFbLfmhSpnqnrZuqEJgJnd8cQplVLciAgX//Cf0ToIeOB9wpmloLQAwpnVmAXgdf6pwjpJIz+XNoeZQQZlODV9vhc1Tuf6owrAk/8qIhFbJH7eI3eEzsvydQEICqBEkZwiALfF70HyHPpqScPV5HFjeFu476SkRA0AzOfy4hYwstj2ZkDgaphE7m6XqnoS7Q0BOPs/sw0kDROzjdXcCMFCNwzIy0EcRcOvBACfh4k0wgOmBX4xjfmk4DKTS31hgNWIKBCI8gdzogTgjYjQWFMw+o9LzJoZ63GUmjWm2wGDc7EvDDOj/1IVMIyD9SUAL0WEhpriRlXv5je5S+U1i2N88zdPuoVkeB+ls4SyxCoP3kVm9jsjpEsBLoOBNC5U9SwpGdakFkviuFP1keblATkTENTYcxkzgxTKOI3jyDxqLkQT87pMA++H3XvJBYtsNbBN6vuXq5S737WqHkW1VgMQNXJ0RshMqbbT33sJ5kpHWymzcJjNTeJIymJZtSQd9NHQHS1vodoFoTMkfbJzpRnLzB2vi6BZAJxWaCr+62BC+jzAxVJb3dmmiLzLwZhZNPE5e880Suo2AZgB8e8idxherqUPnT3brBDTlPxO3Z66rVwIwySXugdNd+5ejhqp/+NmgIwGX3Py3QBmlEi54KlwmjkOytQ+iJrLJj23S4GkOeecg8G091no737qvRRdzE+HLALQoMTBbJgBsCj5RSWUlUVJiZ4SOljb05eLFWgoJ5oY6yTyJp62D39jDANoKKcSocPJD5dQYzlFAFZJflUArgTPZKZwLXAnHmerfJquUkKZEgyzqOb5TuDt1P3nwxobqwPocZA11m4A1mBx5IxNgRH21ti7KbAGiyNn3HoF/gJ0w05A8xclpwAAAABJRU5ErkJggg==' /><h1>{v}</h1><h3>WiFiManager</h3>";
const char HTTP_ROOT_MAIN[]        PROGMEM = "<div class='hero'><h1>{t}</h1><p>{v}</p></div>";

const char * const HTTP_PORTAL_MENU[] PROGMEM = {
"<form action='/wifi'    method='get'><button>Configurar WiFi</button></form><br/>\n", // MENU_WIFI
"<form action='/0wifi'   method='get'><button>Configurar WiFi sin escanear</button></form><br/>\n", // MENU_WIFINOSCAN
"<form action='/info'    method='get'><button>Información del dispositivo</button></form><br/>\n", // MENU_INFO
"<form action='/param'   method='get'><button>Ajustes personalizados</button></form><br/>\n",// MENU_PARAM
"<form action='/close'   method='get'><button>Cerrar portal</button></form><br/>\n", // MENU_CLOSE
"<form action='/restart' method='get'><button>Reiniciar dispositivo</button></form><br/>\n",// MENU_RESTART
"<form action='/exit'    method='get'><button>Salir del portal</button></form><br/>\n",  // MENU_EXIT
"<form action='/erase'   method='get'><button class='D'>Borrar WiFi</button></form><br/>\n", // MENU_ERASE
"<form action='/update'  method='get'><button>Actualizar firmware</button></form><br/>\n",// MENU_UPDATE
"<hr><br/>" // MENU_SEP
};

// const char HTTP_PORTAL_OPTIONS[]   PROGMEM = strcat(HTTP_PORTAL_MENU[0] , HTTP_PORTAL_MENU[3] , HTTP_PORTAL_MENU[7]);
const char HTTP_PORTAL_OPTIONS[]   PROGMEM = "";
const char HTTP_ITEM_QI[]          PROGMEM = "<div role='img' aria-label='{r}%' title='{r}%' class='q q-{q} {i} {h}'></div>"; // rssi icons
const char HTTP_ITEM_QP[]          PROGMEM = "<div class='q {h}'>{r}%</div>"; // rssi percentage {h} = hidden showperc pref
const char HTTP_ITEM[]             PROGMEM = "<div><a href='#p' onclick='c(this)' data-ssid='{V}'>{v}</a>{qi}{qp}</div>"; // {q} = HTTP_ITEM_QI, {r} = HTTP_ITEM_QP
// const char HTTP_ITEM[]            PROGMEM = "<div><a href='#p' onclick='c(this)'>{v}</a> {R} {r}% {q} {e}</div>"; // test all tokens

const char HTTP_FORM_START[]       PROGMEM = "<form class='panel-form' method='POST' action='{v}'>";
const char HTTP_FORM_WIFI[]        PROGMEM = "<div class='field'><label for='s'>SSID</label><input id='s' name='s' maxlength='32' autocorrect='off' autocapitalize='none' placeholder='{v}'></div><div class='field'><label for='p'>Contraseña</label><input id='p' name='p' maxlength='64' type='password' placeholder='{p}'><label class='check'><input type='checkbox' id='showpass' onclick='f()'><span>Mostrar contraseña</span></label></div>";
const char HTTP_FORM_WIFI_END[]    PROGMEM = "";
const char HTTP_FORM_STATIC_HEAD[] PROGMEM = "<hr><br/>";
const char HTTP_FORM_END[]         PROGMEM = "<div class='actions'><button type='submit'>Guardar</button></div></form>";
const char HTTP_FORM_LABEL[]       PROGMEM = "<label for='{i}'>{t}</label>";
const char HTTP_FORM_PARAM_HEAD[]  PROGMEM = "<hr><br/>";
const char HTTP_FORM_PARAM[]       PROGMEM = "<br/><input id='{i}' name='{n}' maxlength='{l}' value='{v}' {c}>\n"; // do not remove newline!

const char HTTP_SCAN_LINK[]        PROGMEM = "<div class='actions'><form action='/wifi?refresh=1' method='POST'><button name='refresh' value='1'>Actualizar búsqueda</button></form></div>";
const char HTTP_SAVED[]            PROGMEM = "<div class='msg'><h4>Guardando credenciales</h4><p>Intentando conectar el ESP a la red. Si falla, vuelve al punto de acceso y prueba otra vez.</p></div>";
const char HTTP_PARAMSAVED[]       PROGMEM = "<div class='msg S'><h4>Guardado</h4><p>Los ajustes se almacenaron correctamente.</p></div>";
const char HTTP_END[]              PROGMEM = "</div></body></html>";
const char HTTP_ERASEBTN[]         PROGMEM = "<div class='actions'><form action='/erase' method='get'><button class='D'>Borrar configuración WiFi</button></form></div>";
const char HTTP_UPDATEBTN[]        PROGMEM = "<div class='actions'><form action='/update' method='get'><button>Actualizar firmware</button></form></div>";
const char HTTP_BACKBTN[]          PROGMEM = "<div class='actions'><form action='/' method='get'><button>Atrás</button></form></div>";

const char HTTP_STATUS_ON[]        PROGMEM = "<div class='msg S'><h4>Conectado</h4><p>{v}<br/><small>IP {i}</small></p></div>";
const char HTTP_STATUS_OFF[]       PROGMEM = "<div class='msg {c}'><h4>No conectado</h4><p>{v}{r}</p></div>"; // {c=class} {v=ssid} {r=status_off}
const char HTTP_STATUS_OFFPW[]     PROGMEM = "<br/>Error de autenticación"; // STATION_WRONG_PASSWORD,  no eps32
const char HTTP_STATUS_OFFNOAP[]   PROGMEM = "<br/>AP no encontrado";   // WL_NO_SSID_AVAIL
const char HTTP_STATUS_OFFFAIL[]   PROGMEM = "<br/>No se pudo conectar"; // WL_CONNECT_FAILED
const char HTTP_STATUS_NONE[]      PROGMEM = "<div class='msg'><h4>Sin AP establecido</h4></div>";
const char HTTP_BR[]               PROGMEM = "<br/>";

const char HTTP_STYLE[]            PROGMEM = "<style>"
"body{margin:0;padding:16px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;color:#111827}"
".shell{min-height:100vh;display:flex;align-items:flex-start;justify-content:center}"
".c{display:block}"
".wrap{text-align:left;display:inline-block;min-width:280px;max-width:540px;width:100%;padding:20px 22px;border-radius:8px;background:#ffffff;border:1px solid #d1d5db;box-shadow:0 1px 3px rgba(0,0,0,0.08)}"
".hero{margin:0 0 14px;padding:0 0 10px;border-bottom:1px solid #e5e7eb}"
".hero h1{margin:0;font-size:1.3rem;color:#111827}"
".hero p{margin:4px 0 0;color:#6b7280;font-size:.85rem}"
"div,input,select{padding:6px;font-size:0.95rem;margin:4px 0;box-sizing:border-box}"
"input,button,select{border-radius:4px;width:100%;border:1px solid #d1d5db;background:#fff;color:#111827}"
"input[type=radio],input[type=checkbox]{width:auto}"
".panel-form{display:block}"
".field{margin:10px 0}"
"label{font-weight:600;font-size:0.85rem;color:#374151;display:block;margin-bottom:2px}"
".check{display:flex;align-items:center;gap:.5rem;margin-top:8px;font-size:.85rem;color:#374151}"
".actions{margin:14px 0 0}"
"button,input[type='button'],input[type='submit']{cursor:pointer;border:0;background:#1f2937;color:#fff;line-height:2.2rem;font-size:0.95rem;width:100%;font-weight:600;border-radius:4px;box-shadow:none}"
"button:hover,input[type='button']:hover,input[type='submit']:hover{background:#111827}"
"button.D{background:#dc2626}"
"button.D:hover{background:#b91c1c}"
"a{color:#2563eb;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}"
".q{height:16px;margin:0;padding:0 5px;text-align:right;min-width:38px;float:right}.q.q-0:after{background-position-x:0}.q.q-1:after{background-position-x:-16px}.q.q-2:after{background-position-x:-32px}.q.q-3:after{background-position-x:-48px}.q.q-4:after{background-position-x:-64px}.q.l:before{background-position-x:-80px;padding-right:5px}.ql .q{float:left}.q:after,.q:before{content:'';width:16px;height:16px;display:inline-block;background-repeat:no-repeat;background-position: 16px 0;"
"background-image:url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAAAQCAMAAADeZIrLAAAAJFBMVEX///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADHJj5lAAAAC3RSTlMAIjN3iJmqu8zd7vF8pzcAAABsSURBVHja7Y1BCsAwCASNSVo3/v+/BUEiXnIoXkoX5jAQMxTHzK9cVSnvDxwD8bFx8PhZ9q8FmghXBhqA1faxk92PsxvRc2CCCFdhQCbRkLoAQ3q/wWUBqG35ZxtVzW4Ed6LngPyBU2CobdIDQ5oPWI5nCUwAAAAASUVORK5CYII=');}"
"@media (-webkit-min-device-pixel-ratio: 2),(min-resolution: 192dpi){.q:before,.q:after {"
"background-image:url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALwAAAAgCAMAAACfM+KhAAAALVBMVEX///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAOrOgAAAADnRSTlMAESIzRGZ3iJmqu8zd7gKjCLQAAACmSURBVHgB7dDBCoMwEEXRmKlVY3L//3NLhyzqIqSUggy8uxnhCR5Mo8xLt+14aZ7wwgsvvPA/ofv9+44334UXXngvb6XsFhO/VoC2RsSv9J7x8BnYLW+AjT56ud/uePMdb7IP8Bsc/e7h8Cfk912ghsNXWPpDC4hvN+D1560A1QPORyh84VKLjjdvfPFm++i9EWq0348XXnjhhT+4dIbCW+WjZim9AKk4UZMnnCEuAAAAAElFTkSuQmCC');"
"background-size: 95px 16px;}}"
".msg{padding:12px 14px;margin:14px 0;border:1px solid #d1d5db;border-left:4px solid #6b7280;background:#f9fafb;color:#111827;text-align:left;border-radius:4px}.msg h4{margin:0 0 4px;font-size:.95rem;color:#111827}.msg p{margin:0;font-size:.85rem;color:#4b5563}.msg.P{border-left-color:#2563eb}.msg.P h4{color:#2563eb}.msg.D{border-left-color:#dc2626}.msg.D h4{color:#dc2626}.msg.S{border-left-color:#16a34a}.msg.S h4{color:#16a34a}"
"dt{font-weight:bold}dd{margin:0;padding:0 0 0.5em 0;min-height:12px}"
"td{vertical-align: top;}"
".h{display:none}"
":disabled {opacity: 0.5;}"
"</style>";

#ifndef WM_NOHELP
const char HTTP_HELP[]             PROGMEM =
 "<div class='msg P'><h4>Páginas disponibles</h4><p>Usa los enlaces de abajo para configurar WiFi, gestionar parámetros y controlar el portal.</p></div>"
 "<table class='table'>"
 "<thead><tr><th>Página</th><th>Función</th></tr></thead><tbody>"
 "<tr><td><a href='/'>/</a></td>"
 "<td>Menú principal.</td></tr>"
 "<tr><td><a href='/wifi'>/wifi</a></td>"
 "<td>Muestra redes WiFi y permite configurar la conexión. (/0wifi sin escaneo)</td></tr>"
 "<tr><td><a href='/wifisave'>/wifisave</a></td>"
 "<td>Guarda la configuración WiFi y conecta el dispositivo.</td></tr>"
 "<tr><td><a href='/param'>/param</a></td>"
 "<td>Página de parámetros.</td></tr>"
 "<tr><td><a href='/info'>/info</a></td>"
 "<td>Página de información.</td></tr>"
 "<tr><td><a href='/u'>/u</a></td>"
 "<td>Actualización OTA.</td></tr>"
 "<tr><td><a href='/close'>/close</a></td>"
 "<td>Cierra la ventana emergente del portal cautivo; el portal seguirá activo.</td></tr>"
 "<tr><td>/exit</td>"
 "<td>Sale del portal de configuración y lo cierra por completo.</td></tr>"
 "<tr><td>/restart</td>"
 "<td>Reinicia el dispositivo.</td></tr>"
 "<tr><td>/erase</td>"
 "<td>Borra la configuración WiFi y reinicia el dispositivo. No volverá a conectarse hasta cargar nuevos datos.</td></tr>"
 "</table>"
 "<p>Github <a href='https://github.com/tzapu/WiFiManager'>https://github.com/tzapu/WiFiManager</a>.</p>";
#else
const char HTTP_HELP[]             PROGMEM = "";
#endif

const char HTTP_UPDATE[] PROGMEM = "<div class='msg P'><h4>Subir nuevo firmware</h4><p>Selecciona un archivo .bin y súbelo para iniciar la actualización.</p></div><form class='panel-form' method='POST' action='u' enctype='multipart/form-data' onchange=\"(function(el){document.getElementById('uploadbin').style.display = el.value=='' ? 'none' : 'initial';})(this)\"><input type='file' name='update' accept='.bin,application/octet-stream'><button id='uploadbin' type='submit' class='h D'>Actualizar</button></form><small><a href='http://192.168.4.1/update' target='_blank'>* Puede no funcionar dentro del portal cautivo; abre http://192.168.4.1 en el navegador</a><small>";
const char HTTP_UPDATE_FAIL[] PROGMEM = "<div class='msg D'><strong>Actualización fallida.</strong><br/>Reinicia el dispositivo e inténtalo de nuevo</div>";
const char HTTP_UPDATE_SUCCESS[] PROGMEM = "<div class='msg S'><strong>Actualización correcta.</strong><br/>El dispositivo se está reiniciando...</div>";

#ifdef WM_JSTEST
const char HTTP_JS[] PROGMEM =
"<script>function postAjax(url, data, success) {"
"    var params = typeof data == 'string' ? data : Object.keys(data).map("
"            function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]) }"
"        ).join('&');"
"    var xhr = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject(\"Microsoft.XMLHTTP\");"
"    xhr.open('POST', url);"
"    xhr.onreadystatechange = function() {"
"        if (xhr.readyState>3 && xhr.status==200) { success(xhr.responseText); }"
"    };"
"    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');"
"    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');"
"    xhr.send(params);"
"    return xhr;}"
"postAjax('/status', 'p1=1&p2=Hello+World', function(data){ console.log(data); });"
"postAjax('/status', { p1: 1, p2: 'Hello World' }, function(data){ console.log(data); });"
"</script>";
#endif

// Info html
// @todo remove html elements from progmem, repetetive strings
#ifdef ESP32
	const char HTTP_INFO_esphead[]    PROGMEM = "<h3>esp32</h3><hr><dl>";
	const char HTTP_INFO_chiprev[]    PROGMEM = "<dt>Revisión del chip</dt><dd>{1}</dd>";
  	const char HTTP_INFO_lastreset[]  PROGMEM = "<dt>Último motivo de reinicio</dt><dd>CPU0: {1}<br/>CPU1: {2}</dd>";
  	const char HTTP_INFO_aphost[]     PROGMEM = "<dt>Nombre del punto de acceso</dt><dd>{1}</dd>";
    const char HTTP_INFO_psrsize[]    PROGMEM = "<dt>Tamaño de PSRAM</dt><dd>{1} bytes</dd>";
	const char HTTP_INFO_temp[]       PROGMEM = "<dt>Temperatura</dt><dd>{1} C&deg; / {2} F&deg;</dd><dt>Hall</dt><dd>{3}</dd>";
#else
	const char HTTP_INFO_esphead[]    PROGMEM = "<h3>esp8266</h3><hr><dl>";
	const char HTTP_INFO_fchipid[]    PROGMEM = "<dt>ID del chip Flash</dt><dd>{1}</dd>";
	const char HTTP_INFO_corever[]    PROGMEM = "<dt>Versión del core</dt><dd>{1}</dd>";
	const char HTTP_INFO_bootver[]    PROGMEM = "<dt>Versión del boot</dt><dd>{1}</dd>";
	const char HTTP_INFO_lastreset[]  PROGMEM = "<dt>Último motivo de reinicio</dt><dd>{1}</dd>";
	const char HTTP_INFO_flashsize[]  PROGMEM = "<dt>Tamaño real de flash</dt><dd>{1} bytes</dd>";
#endif

const char HTTP_INFO_memsmeter[]  PROGMEM = "<br/><progress value='{1}' max='{2}'></progress></dd>";
const char HTTP_INFO_memsketch[]  PROGMEM = "<dt>Memoria - tamaño de sketch</dt><dd>Usado / Total bytes<br/>{1} / {2}";
const char HTTP_INFO_freeheap[]   PROGMEM = "<dt>Memoria - heap libre</dt><dd>{1} bytes disponibles</dd>";
const char HTTP_INFO_wifihead[]   PROGMEM = "<br/><h3>WiFi</h3><hr>";
const char HTTP_INFO_uptime[]     PROGMEM = "<dt>Tiempo activo</dt><dd>{1} min {2} seg</dd>";
const char HTTP_INFO_chipid[]     PROGMEM = "<dt>ID del chip</dt><dd>{1}</dd>";
const char HTTP_INFO_idesize[]    PROGMEM = "<dt>Tamaño de flash</dt><dd>{1} bytes</dd>";
const char HTTP_INFO_sdkver[]     PROGMEM = "<dt>Versión SDK</dt><dd>{1}</dd>";
const char HTTP_INFO_cpufreq[]    PROGMEM = "<dt>Frecuencia CPU</dt><dd>{1}MHz</dd>";
const char HTTP_INFO_apip[]       PROGMEM = "<dt>IP del punto de acceso</dt><dd>{1}</dd>";
const char HTTP_INFO_apmac[]      PROGMEM = "<dt>MAC del punto de acceso</dt><dd>{1}</dd>";
const char HTTP_INFO_apssid[]     PROGMEM = "<dt>SSID del punto de acceso</dt><dd>{1}</dd>";
const char HTTP_INFO_apbssid[]    PROGMEM = "<dt>BSSID</dt><dd>{1}</dd>";
const char HTTP_INFO_stassid[]    PROGMEM = "<dt>SSID de la estación</dt><dd>{1}</dd>";
const char HTTP_INFO_staip[]      PROGMEM = "<dt>IP de la estación</dt><dd>{1}</dd>";
const char HTTP_INFO_stagw[]      PROGMEM = "<dt>Puerta de enlace de la estación</dt><dd>{1}</dd>";
const char HTTP_INFO_stasub[]     PROGMEM = "<dt>Subred de la estación</dt><dd>{1}</dd>";
const char HTTP_INFO_dnss[]       PROGMEM = "<dt>Servidor DNS</dt><dd>{1}</dd>";
const char HTTP_INFO_host[]       PROGMEM = "<dt>Nombre del host</dt><dd>{1}</dd>";
const char HTTP_INFO_stamac[]     PROGMEM = "<dt>MAC de la estación</dt><dd>{1}</dd>";
const char HTTP_INFO_conx[]       PROGMEM = "<dt>Conectado</dt><dd>{1}</dd>";
const char HTTP_INFO_autoconx[]   PROGMEM = "<dt>Autoconexión</dt><dd>{1}</dd>";

const char HTTP_INFO_aboutver[]     PROGMEM = "<dt>WiFiManager</dt><dd>{1}</dd>";
const char HTTP_INFO_aboutarduino[] PROGMEM = "<dt>Arduino</dt><dd>{1}</dd>";
const char HTTP_INFO_aboutsdk[]     PROGMEM = "<dt>ESP-SDK/IDF</dt><dd>{1}</dd>";
const char HTTP_INFO_aboutdate[]    PROGMEM = "<dt>Fecha de compilación</dt><dd>{1}</dd>";

const char S_brand[]              PROGMEM = "WiFiManager";
const char S_debugPrefix[]        PROGMEM = "*wm:";
const char S_y[]                  PROGMEM = "Sí";
const char S_n[]                  PROGMEM = "No";
const char S_enable[]             PROGMEM = "Habilitado";
const char S_disable[]            PROGMEM = "Deshabilitado";
const char S_GET[]                PROGMEM = "GET";
const char S_POST[]               PROGMEM = "POST";
const char S_NA[]                 PROGMEM = "Desconocido";
const char S_passph[]             PROGMEM = "********";
const char S_titlewifisaved[]     PROGMEM = "Credenciales guardadas";
const char S_titlewifisettings[]  PROGMEM = "Ajustes guardados";
const char S_titlewifi[]          PROGMEM = "Conectar WiFi";
const char S_titleinfo[]          PROGMEM = "Información del dispositivo";
const char S_titleparam[]         PROGMEM = "Ajustes personalizados";
const char S_titleparamsaved[]    PROGMEM = "Ajustes guardados";
const char S_titleexit[]          PROGMEM = "Salir del portal";
const char S_titlereset[]         PROGMEM = "Reiniciar";
const char S_titleerase[]         PROGMEM = "Borrar WiFi";
const char S_titleclose[]         PROGMEM = "Cerrar portal";
const char S_options[]            PROGMEM = "opciones";
const char S_nonetworks[]         PROGMEM = "No se encontraron redes. Pulsa actualizar para volver a buscar.";
const char S_staticip[]           PROGMEM = "IP estática";
const char S_staticgw[]           PROGMEM = "Puerta de enlace estática";
const char S_staticdns[]          PROGMEM = "DNS estático";
const char S_subnet[]             PROGMEM = "Subred";
const char S_exiting[]            PROGMEM = "Saliendo";
const char S_resetting[]          PROGMEM = "El módulo se reiniciará en unos segundos.";
const char S_closing[]            PROGMEM = "Puedes cerrar la página, el portal seguirá ejecutándose";
const char S_error[]              PROGMEM = "Ha ocurrido un error";
const char S_notfound[]           PROGMEM = "Archivo no encontrado\n\n";
const char S_uri[]                PROGMEM = "URI: ";
const char S_method[]             PROGMEM = "\nMétodo: ";
const char S_args[]               PROGMEM = "\nArgumentos: ";
const char S_parampre[]           PROGMEM = "param_";

// debug strings
const char D_HR[]                 PROGMEM = "--------------------";


// softap ssid default prefix
#ifdef ESP8266
    const char S_ssidpre[]        PROGMEM = "ESP";
#elif defined(ESP32)
    const char S_ssidpre[]        PROGMEM = "ESP32";
#else
    const char S_ssidpre[]        PROGMEM = "WM";
#endif

// END WIFI_MANAGER_OVERRIDE_STRINGS
#endif

#endif
