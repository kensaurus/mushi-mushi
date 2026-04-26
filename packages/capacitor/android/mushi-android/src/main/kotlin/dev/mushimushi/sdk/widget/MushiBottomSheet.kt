package dev.mushimushi.sdk.widget

import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatDialogFragment
import dev.mushimushi.sdk.config.MushiConfig

/**
 * Bottom-sheet dialog for collecting a free-form bug description plus a
 * category tag. We avoid the Material `BottomSheetDialogFragment` to keep
 * the SDK free of the Material lib dependency — a thin styled dialog is
 * enough and reduces APK bloat for consumers.
 */
class MushiBottomSheet : AppCompatDialogFragment() {

    var config: MushiConfig? = null
    var attachedScreenshot: String? = null
    var initialCategory: String? = null
    var onSubmit: ((Map<String, Any?>) -> Unit)? = null

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val dialog = super.onCreateDialog(savedInstanceState)
        dialog.window?.apply {
            setGravity(Gravity.BOTTOM)
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        return dialog
    }

    override fun onCreateView(
        inflater: android.view.LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        val cfg = config ?: throw IllegalStateException("MushiBottomSheet requires config")
        val ctx = requireContext()
        val accent = parseHex(cfg.theme.accentColor) ?: Color.parseColor("#22C55E")

        val root = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            background = GradientDrawable().apply {
                setColor(if (cfg.theme.dark) Color.BLACK else Color.WHITE)
                cornerRadii = floatArrayOf(32f, 32f, 32f, 32f, 0f, 0f, 0f, 0f)
            }
        }

        val title = TextView(ctx).apply {
            text = "Report a bug"
            textSize = 20f
            setTextColor(if (cfg.theme.dark) Color.WHITE else Color.BLACK)
        }
        root.addView(title)

        val radio = RadioGroup(ctx).apply { orientation = RadioGroup.HORIZONTAL }
        val categories = listOf("bug", "slow", "visual", "confusing")
        categories.forEachIndexed { idx, label ->
            radio.addView(RadioButton(ctx).apply {
                id = idx
                text = label
                if (idx == (categories.indexOf(initialCategory).takeIf { it >= 0 } ?: 0)) isChecked = true
            })
        }
        root.addView(radio)

        val description = EditText(ctx).apply {
            hint = "What went wrong? (${cfg.minDescriptionLength}+ characters)"
            minLines = 4
            maxLines = 8
            setPadding(24, 24, 24, 24)
            background = GradientDrawable().apply {
                setStroke(2, Color.LTGRAY)
                cornerRadius = 16f
            }
        }
        root.addView(description, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 24 })

        val submit = Button(ctx).apply {
            text = "Submit"
            isEnabled = false
            setTextColor(Color.WHITE)
            background = GradientDrawable().apply {
                setColor(accent)
                cornerRadius = 24f
            }
        }
        root.addView(submit, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = 24 })

        description.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                val ok = (s?.length ?: 0) >= cfg.minDescriptionLength
                submit.isEnabled = ok
                submit.alpha = if (ok) 1f else 0.4f
            }
        })

        submit.setOnClickListener {
            val payload = mutableMapOf<String, Any?>(
                "description" to description.text.toString(),
                "category" to categories[radio.checkedRadioButtonId.coerceIn(0, categories.lastIndex)]
            )
            attachedScreenshot?.let { payload["screenshot"] = it }
            onSubmit?.invoke(payload)
            dismiss()
        }

        return root
    }

    private fun parseHex(s: String): Int? = runCatching {
        Color.parseColor(if (s.startsWith("#")) s else "#$s")
    }.getOrNull()
}
