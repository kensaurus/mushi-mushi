import type { MushiLocale } from './types';

export const es: MushiLocale = {
  widget: {
    trigger: 'Reportar problema',
    title: 'Reportar un problema',
    close: 'Cerrar',
    back: 'Volver',
    submit: 'Enviar',
    submitting: 'Enviando…',
    submitted: '¡Gracias! Tu reporte ha sido enviado.',
    error: 'Algo salió mal. Por favor, inténtalo de nuevo.',
  },
  step1: {
    heading: '¿Qué tipo de problema?',
    categories: {
      bug: 'Error',
      slow: 'Lento',
      visual: 'Problema visual',
      confusing: 'Confuso',
      other: 'Otro',
    },
    categoryDescriptions: {
      bug: 'Algo está roto o no funciona',
      slow: 'Problema de rendimiento o carga lenta',
      visual: 'Problema de diseño, estilo o visualización',
      confusing: 'Difícil de entender o navegar',
      other: 'Otro problema',
    },
  },
  step2: {
    heading: '¿Qué pasó?',
    intents: {
      bug: ['Crash', 'Sin respuesta', 'Pérdida de datos', 'Resultado incorrecto', 'Otro'],
      slow: ['Carga de página', 'Interacción', 'Llamada API', 'Animación', 'Otro'],
      visual: ['Layout roto', 'Superposición', 'Elemento faltante', 'Color/fuente incorrecta', 'Otro'],
      confusing: ['Etiqueta confusa', 'Sin ayuda', 'Flujo inesperado', 'Navegación perdida', 'Otro'],
      other: ['Solicitud de función', 'Accesibilidad', 'Error tipográfico', 'Otro'],
    },
  },
  step3: {
    heading: 'Cuéntanos más',
    descriptionPlaceholder: 'Describe lo que pasó…',
    screenshotButton: 'Adjuntar captura',
    screenshotAttached: 'Captura adjunta ✓',
    screenshotCapturing: 'Tomando captura…',
    screenshotFailed: 'No se pudo capturar — descríbelo en su lugar',
    screenshotPreviewAlt: 'Vista previa de la captura que se enviará',
    screenshotSensitiveHint: 'Revisa la vista previa — quítala si se ve información privada (saldos, datos personales).',
    elementButton: 'Seleccionar elemento',
    elementSelected: 'Elemento seleccionado ✓',
    elementCapturing: 'Haz clic en cualquier elemento…',
    elementSelectorHint: 'Clic en cualquier elemento · Esc para cancelar',
    optional: '(opcional)',
    tooShort: 'Un poco más de detalle nos ayuda a resolverlo',
    examplePrompts: [
      'El botón guardar no responde',
      'La página se congeló 10 segundos',
      'El diseño se ve roto aquí',
    ],
  },
};
