import type { InputHTMLAttributes } from 'react'
import './TextInput.css'

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export function TextInput({ label, id, ...props }: TextInputProps) {
  return (
    <label className="ui-input">
      {label ? <span className="ui-input__label">{label}</span> : null}
      <input id={id} {...props} />
    </label>
  )
}
