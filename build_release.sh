#!/bin/bash

set -o errexit -o nounset -o pipefail

basedir=$(pwd)

function build(){        
    contractdir=$(realpath "$basedir/$1")
    cd $contractdir
    # name is extract from Cargo.toml
    name=$(basename "$1")
    build_name=$(grep -o 'name *=.*' Cargo.toml | awk -F'[="]' '{print $3}')
    build_name=${build_name//-/_}
    
    CARGO=$([[ -f 'Xargo.toml' && $(rustup default) =~ ^nightly.* ]] && echo 'xargo' || echo 'cargo')

    echo "Building contract in $contractdir"

    # Linker flag "-s" for stripping (https://github.com/rust-lang/cargo/issues/3483#issuecomment-431209957)
    # Note that shortcuts from .cargo/config are not available in source code packages from crates.io
    mkdir -p artifacts

    if [ "$build_debug" == 'true' ]; then
        $CARGO build -q --lib --target-dir "$basedir/target" --target wasm32-unknown-unknown
        cp "$basedir/target/wasm32-unknown-unknown/debug/$build_name.wasm" artifacts        
    else
        RUSTFLAGS='-C link-arg=-s' $CARGO build -q --release --lib --target-dir "$basedir/target" --target wasm32-unknown-unknown
        # wasm-optimize on all results
        echo "Optimizing $name.wasm"
        if [ ! `which wasm-opt` ] 
        then 
            echo "install binaryen"
            if [ $(uname) == 'Linux' ]
            then 
                sudo apt install binaryen -y
            else 
                brew install binaryen
            fi 
        fi 
        # rm old file to clear cache when displaying size
        rm -f "artifacts/$name.wasm"
        wasm-opt -Os "$basedir/target/wasm32-unknown-unknown/release/$build_name.wasm" -o "artifacts/$name.wasm"
    fi

    # create schema if there is
    if [ "$build_schema" == 'true' ]; then            
        local bin=$([ -d "$contractdir/src/bin" ] && echo "bin" || echo "example")        
        echo "Creating schema in $contractdir"
        (
            cd artifacts
            cargo run -q --$bin schema --target-dir "$basedir/target"
        )
    fi

    # show content    
    du -h "$contractdir/artifacts/$name.wasm"    
}

contractdirs=()
build_debug=false
build_schema=false
while test $# -gt 0; do    
   case "$1" in
    --debug|-d) build_debug=true
    ;;
    --schema|-s) build_schema=true
    ;;
    *) contractdirs+=("$1")
    ;;
   esac
   shift   
done

if [ ! -z `command -v sccache` ]
then
    echo "Info: sccache stats before build"
    sccache -s
    if [ $? -eq 0 ]; then
        export RUSTC_WRAPPER=sccache
    fi
else 
    echo "Run: 'cargo install sccache' for faster build"
fi


# build all contracts
for contractdir in "${contractdirs[@]}"
do
    build $contractdir
done

echo "done"
