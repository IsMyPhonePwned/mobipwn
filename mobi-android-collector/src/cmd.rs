use clap::{command, Command};

use crate::files;
use crate::process;

#[cfg(feature = "yara")]
use crate::yara;

pub fn command(name: &'static str) -> Command {
    Command::new(name).help_template(
        r#"{about-with-newline}
{usage-heading}
  {usage}

{all-args}
"#,
    )
}

pub fn cli() -> Command {
    let mut subcommands = vec![files::files_find_cmd(), process::process_ps_cmd()];
    #[cfg(feature = "yara")]
    subcommands.push(yara::yara_cmd());
    command!().subcommand_required(true).subcommands(subcommands)
}
